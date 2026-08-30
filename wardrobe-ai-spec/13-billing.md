# 13 — Billing

**Scope:** **PROD** — do not build during the test phase · **Depends on:** 03 ·
**Owns:** `app/api/webhooks/razorpay/route.ts`, plan state, the paywall

## Responsibility

Razorpay subscriptions at ₹99–299/month, and the one rule that must never be violated: the
client cannot change its own plan.

## Before you write a line of this module

**Upgrade Vercel to Pro first.**

Vercel's fair-use policy restricts the Hobby plan to non-commercial personal use, and defines
commercial usage as any deployment used for the financial gain of anyone involved — listing
*any method of requesting or processing payment from visitors*, advertising, affiliate
linking as a primary purpose, and explicitly including **donations**.

Shipping payments on Hobby is a terms violation and Vercel can pause the account without
warning owed to you. This is the only item in the entire spec that costs money and cannot be
reversed by editing a file.

$20/month. At ₹99 premium that is 27 paying users to break even on total infrastructure; at
₹299, 9 users.

## Contracts

`POST /api/webhooks/razorpay` — unauthenticated, signature-verified. See `api-contracts.md`.

Plan state is `profiles.plan` (`free` | `premium`) and `profiles.plan_renews_at`.
`profiles.razorpay_sub_id` links to the subscription.

## Behaviour

### 1. The webhook is the only writer

Nothing else in the codebase writes `profiles.plan`. Not the client, not a success redirect,
not an optimistic update. A payment success page is a claim by the browser; the webhook is
the fact.

```
1. read raw body BEFORE parsing
2. HMAC-SHA256 with RAZORPAY_KEY_SECRET, compare to x-razorpay-signature
   using a timing-safe comparison
3. mismatch → 400, log, stop. Do not parse.
4. check event id against processed_webhooks; already seen → 200, no-op
5. handle
6. record event id
7. 200
```

Signature check before parse. Idempotency by event id, because Razorpay retries and a
retried `subscription.charged` must not extend the plan twice.

Add the table in this module's migration:

```sql
create table processed_webhooks (
  event_id text primary key,
  received_at timestamptz not null default now()
);
```

### 2. Events

| Event | Effect |
|---|---|
| `subscription.activated` | `plan = 'premium'`, set `plan_renews_at` |
| `subscription.charged` | extend `plan_renews_at` |
| `subscription.halted` | keep premium, start grace period, notify |
| `subscription.cancelled` | premium until `plan_renews_at`, then downgrade |
| `subscription.completed` | downgrade at period end |

### 3. Downgrade is the interesting case

A premium user with 60 items who cancels is over the 25-item free cap.

**Archive the excess, never delete it.** Keep the 25 most recently worn (then most recently
added) active; archive the rest. Tell the user plainly what happened and that resubscribing
restores everything instantly.

Deleting a user's data because they stopped paying is the kind of thing people post
screenshots of. It is also unnecessary — archived items cost you 63 KB each.

Note the interaction with module 05 §5: archived items still count toward `item_count`. So
the downgrade path must *not* rely on the counter dropping. Handle plan enforcement by
checking `plan` and active (non-archived) count explicitly at this boundary, and document
it — it is the one place the two rules rub against each other.

### 4. The paywall

Two surfaces:

- **The 25-item wall.** The main conversion moment: the user is mid-task, invested, and has
  just outgrown the free tier. Deserves a designed screen, not a toast.
- **Premium AI features.** Chat and LLM rerank return `PREMIUM_REQUIRED` (module 12 §5),
  which the UI renders as an upgrade prompt rather than an error.

### 5. Test mode

Razorpay test keys in staging, live keys in production only. Never the reverse; a live key
in a preview deployment is a real charge on a real card.

### 6. What is deliberately not here

Refunds, proration, annual plans, coupons, team billing. Every one is a reasonable thing to
want and none belong in the first version of a payment integration for a product with fewer
than a hundred paying users. Handle refunds manually in the Razorpay dashboard until the
volume makes that annoying.

## Acceptance

- [ ] **Vercel Pro is active before this module is deployed**
- [ ] a request with an invalid signature is rejected with 400 and never parsed
- [ ] a replayed webhook with a seen event id is a no-op returning 200
- [ ] `subscription.activated` flips the plan; nothing else in the codebase can
- [ ] cancellation keeps premium until period end, then downgrades
- [ ] downgrade with 60 items archives 35 and deletes none
- [ ] the 25-item wall renders the upgrade screen, not an error toast
- [ ] staging uses test keys — verified by asserting the key prefix at startup

## Out of scope

- Everything in §6.
- Affiliate commerce, brand partnerships, B2B APIs. All are in the business plan and none
  are in this codebase.
