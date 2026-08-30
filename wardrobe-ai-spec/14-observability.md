# 14 — Observability

**Scope:** TEST · **Depends on:** 02 · **Owns:** `events`, `lib/events.ts`,
`app/api/health/route.ts`, Sentry setup

## Responsibility

Know whether the product works and whether anyone is using it. At 15 users this matters
*more* than at 5,000, because there is no aggregate to hide behind — every data point is one
fifteenth of everything you know.

## Contracts

```ts
// lib/events.ts
export function track(name: EventName, props?: Record<string, unknown>): Promise<void>;

export type EventName =
  | 'signup' | 'onboarding_completed'
  | 'item_uploaded' | 'item_tagged' | 'item_corrected' | 'item_deleted'
  | 'recommendations_viewed' | 'outfit_saved' | 'outfit_planned' | 'outfit_worn'
  | 'feedback_given'
  | 'chat_message' | 'quota_hit' | 'ai_budget_hit'
  | 'upgrade_prompt_shown' | 'upgrade_started';
```

`GET /api/health` → see `api-contracts.md`.

## Behaviour

### 1. Three numbers decide the test phase

Everything else is secondary. These are the questions you cannot answer by asking testers,
because people are unreliable narrators about their own behaviour.

**Correction rate** — is tagging actually working?

```sql
select props->>'field' as field, count(*) corrections
  from events where name = 'item_corrected'
 group by 1 order by 2 desc;
-- divide by count of item_tagged * fields_per_item; target < 25%
```

Expect `material` and `formality` to dominate — they are genuinely hard from one photo of a
garment on a bed. If `category` or `primary_color` show up high, the prompt is broken, not
the task.

**Onboarding completion** — does anyone get past the tedious part?

```sql
select user_id,
       min(created_at) filter (where name = 'signup') as signed_up,
       min(created_at) filter (where name = 'item_uploaded') as first_item,
       (select created_at from events e2
         where e2.user_id = e.user_id and e2.name = 'item_uploaded'
         order by created_at offset 9 limit 1) as tenth_item
  from events e group by user_id;
-- target: > 10 of 15 reach a tenth item
```

**Day-7 return** — does anyone come back?

```sql
select count(distinct user_id)
  from events e
 where created_at::date = (
   select min(created_at)::date + 7 from events e2 where e2.user_id = e.user_id);
-- target: > 5 of 15
```

Plus the recommendation quality signal: thumbs-up rate above 60%.

### 2. Events are fire-and-forget

`track()` never blocks a response and never throws into the caller. Wrap it, swallow errors,
log them. An analytics write failing must not fail a user's upload.

Do not batch client-side. At this volume the complexity buys nothing.

### 3. Retention is what keeps you inside the free tier

`events` is the only unbounded table that isn't user-value data, and at production scale it
is over half the remaining headroom on a 500 MB database. The `pg_cron` job deleting rows
older than 30 days is what makes the numbers in the design work.

Test phase: nothing to collect; leave the job commented (module 02 §4).

If you later want long-range analytics, aggregate nightly into a small rollup table and
still drop the raw rows.

### 4. Sentry

Free tier, wired on the first deploy rather than after the first incident. With 15 users you
get a stack trace instead of a message saying "it didn't work".

Configure: `beforeSend` strips `Authorization` headers and any `NEXT_PUBLIC_` values that
could carry a session; scrub image URLs, which are signed and would otherwise sit in an
error report.

Sample at 100%. At this volume there is nothing to sample.

### 5. Health check

Must actually query Postgres:

```ts
const t0 = Date.now();
const { error } = await supabase.from('profiles').select('id').limit(1);
```

A health check that only proves Next.js booted will report green through a paused, exhausted,
or unreachable database — which are the failures you actually have on this stack.

Point an external uptime monitor at it. In production, also point one at staging weekly:
Supabase pauses free projects after 7 days idle, and staging is exactly what gets caught by
that.

### 6. What not to build

No dashboard. Fifteen users produce numbers you read with four SQL queries, and time spent
building charts is time not spent talking to the testers — which is the actual research
method at this size.

Write the queries in `docs/queries.sql`, run them weekly, and keep the answers in a text
file. Build a dashboard when reading the queries becomes the bottleneck, which will not be
during the test phase.

### 7. Privacy

Events carry `user_id` and event-shaped properties. Never garment images, never free-text
chat content, never colour data that could reconstruct someone's wardrobe outside the tables
that already hold it under RLS.

`chat_message` records that a message happened, its token counts, and its latency. Not what
was said.

## Acceptance

- [ ] every event in `EventName` is emitted from exactly one place
- [ ] a failing `track()` never fails the request that triggered it
- [ ] `item_corrected` fires per changed field with old and new values
- [ ] the four queries in §1 run against real data and return sensible numbers
- [ ] `/api/health` returns 503 when the database is unreachable — test by revoking the key
- [ ] Sentry captures a deliberately thrown server error with no secrets in the payload
- [ ] no event payload contains an image URL or chat text

## Out of scope

- Dashboards, funnels, cohort tooling.
- Third-party product analytics. `events` plus SQL is sufficient and keeps user data in one
  place, which is easier to defend when someone asks.
- Session replay. You are recording people's wardrobes; don't also record their screens.
