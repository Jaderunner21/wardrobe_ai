# 12 — AI budget guard

**Scope:** TEST · **Depends on:** 02 · **Owns:** `ai_usage`, `lib/budget.ts`

## Responsibility

Make it impossible for any single user — malicious, buggy, or just enthusiastic — to run up
an unbounded AI bill. Every model call in the codebase passes through here first.

Small module, disproportionate importance. One scripted retry loop against an unmetered
endpoint is a five-figure rupee bill, and the difference between an attacker and a friend
whose client got stuck in a loop is nothing at all from the billing API's point of view.

## Contracts

```ts
// lib/budget.ts — server only
export async function assertBudget(userId: string, kind: AiCallKind): Promise<void>;
// throws AppError('AI_BUDGET_EXCEEDED', …, 429)

export async function recordUsage(
  userId: string, kind: AiCallKind, inTokens: number, outTokens: number,
): Promise<void>;

export async function getUsage(userId: string, day: string): Promise<AiUsage>;
```

Limits live in `types.ts`:

```ts
AI_LIMITS      = { free:    { tag: 40,  chat: 0,  rerank: 0  },
                   premium: { tag: 100, chat: 20, rerank: 15 } };
AI_LIMITS_TEST = { free:    { tag: 100, chat: 50, rerank: 50 },
                   premium: { tag: 100, chat: 50, rerank: 50 } };
```

Select via `process.env.PHASE === 'test'`.

## Behaviour

### 1. Check before, record after

```
assertBudget(userId, kind)   ← throws before any network call
    ↓
model call
    ↓
recordUsage(userId, kind, inTokens, outTokens)
```

Never the reverse, and never both in one place after the call. A crash between the two costs
you one free call; a check *after* the call costs you the call you were trying to prevent.

Modules 06 and 11 both follow this and must not be allowed to skip it.

### 2. Atomic increment

```sql
insert into ai_usage (user_id, day, tag_calls, in_tokens, out_tokens)
values ($1, $2, 1, $3, $4)
on conflict (user_id, day) do update
  set tag_calls  = ai_usage.tag_calls + 1,
      in_tokens  = ai_usage.in_tokens + excluded.in_tokens,
      out_tokens = ai_usage.out_tokens + excluded.out_tokens;
```

Never read-modify-write from application code. Concurrent uploads would each read the same
count and the cap would leak.

### 3. "Day" is the user's day

`day` is computed in `profile.timezone`, not UTC. A user in `Asia/Kolkata` whose budget
resets at 05:30 local because someone used `current_date` will report it as a bug, and they
will be right.

### 4. Three independent layers

This module is one of three, because any single one can be misconfigured:

| Layer | Catches | Where |
|---|---|---|
| Per-user daily caps | one user, runaway client or abuse | here |
| Cloudflare WAF rate limit on `/api/ai/*` | distributed or scripted abuse | module 15, PROD |
| Google Cloud billing alert at ₹1,500 | everything the first two missed | module 15 |

Do not treat the billing alert as the safety net. It tells you after the money is spent.

### 5. Rejection is a product surface

`AI_BUDGET_EXCEEDED` renders a real message — "You've used today's 20 stylist messages.
They reset at midnight." — not a generic error toast. Include the reset time; a user who
knows when it comes back waits, and one who doesn't files a support message.

For a free user hitting a premium-only kind, `PREMIUM_REQUIRED` is the right code, not
`AI_BUDGET_EXCEEDED`. The distinction matters because one is an upgrade prompt and the other
is a "come back tomorrow".

### 6. Test phase

Limits raised via `AI_LIMITS_TEST` so testers are not throttled while giving feedback — but
still finite. A tester with a broken client bills you exactly as hard as an attacker would.

Set `PHASE=test` in the environment and flip it at production. One variable, no code change.

### 7. Observability

Surface today's usage in settings for the user, and expose an aggregate query for yourself:

```sql
select day, sum(tag_calls) tags, sum(chat_calls) chats, sum(llm_calls) reranks,
       sum(in_tokens) tin, sum(out_tokens) tout
  from ai_usage where day > current_date - 14
 group by day order by day desc;
```

At current Flash-Lite rates (₹0.0102 tag · ₹0.038 chat · ₹0.039 rerank), that query is your
bill before the bill arrives.

## Acceptance

- [ ] a user at their tag cap gets `AI_BUDGET_EXCEEDED` and **no** Gemini call is made —
      verify by asserting the fetch mock was never invoked
- [ ] 20 concurrent tag requests from one user at cap−1 result in exactly one success
- [ ] budget resets at local midnight for a non-UTC timezone
- [ ] a free user requesting chat gets `PREMIUM_REQUIRED`, not `AI_BUDGET_EXCEEDED`
- [ ] `recordUsage` accumulates tokens correctly across concurrent calls
- [ ] every Gemini call site in the codebase calls `assertBudget` first (grep in CI)
- [ ] `PHASE=test` raises the limits; unsetting it restores production caps

## Out of scope

- Per-request cost estimation in rupees. Token counts are enough; convert in a query.
- Org or team budgets. One user, one budget.
- Soft limits and warnings. A hard cap with a clear message is better than a warning nobody
  reads.
