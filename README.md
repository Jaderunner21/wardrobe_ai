# Wardrobe AI

Photograph a garment once; the model files it, and the app dresses you from what you
actually own.

The specification lives in [`wardrobe-ai-spec/`](wardrobe-ai-spec/README.md) and is the
authority for data model and behaviour. This README covers only how to run what is
built.

## Status — every module built

```
L0  Foundation      01 ✓ → 02 ✓ → 03 ✓ → 16(tokens+shell) ✓ → 15(pipeline, env) ✓
L1  Wardrobe core   04 ✓ → 05 ✓ → 16(wardrobe, upload, bin) ✓
L2  Tagging         12 ✓ → 06 ✓
L3  Recommendations 07 ✓ → 08 ✓ → 09 ✓ → 10 ✓ → 16(dashboard, outfits) ✓
L4  AI + polish     11 ✓(rerank) → 17 ✓ → 18 ✓ → 16(states, mobile) ✓
L5  AI ENGINE       19 ✓
L6  Production      13 ✓ → 14 ✓ → 15 ✓
```

Module 11's chat half is deferred to production (module 16 §7.4): there is no chat
screen in eighteen prototype screenshots, and it is the expensive half. The rerank half
shipped.

Sixteen migrations, `0001` through `0016`. Apply them in filename order.

What exists: all three Supabase clients, session middleware and route protection,
email-OTP and Google sign-in, the design tokens with a working dark mode, the shell
(desktop top bar + mobile tab bar), account export and deletion, `/api/health`, and CI
with the spec's eight gates plus five more added since.

Module 04 adds the media pipeline: client-side WebP compression with EXIF stripped,
sha-256 dedupe hashing, `POST /api/items/presign`, direct-to-storage signed uploads at
a concurrency of 3, and day-rounded signed read URLs. No image byte passes through a
function.

Module 05 adds the wardrobe itself: item CRUD, the server-rendered grid with facet
counts, URL-driven filters, search and four sorts, cursor paging, the Review & Edit
upload flow with manual entry, drafts, archive, and the Bin with restore and permanent
delete. Manual entry is built first on purpose (module 05 §1) — it is the permanent
fallback for when tagging is down or wrong, and it doubles as the correction UI that
produces the correction-rate metric.

Module 12 adds the AI budget guard: per-user daily caps enforced as an atomic
reservation in Postgres before any model call goes out, token accounting after it
returns, and today's usage on the settings screen. Nothing calls a model yet — the
guard is in place first, on purpose.

Module 06 adds tagging: `gemini-3.5-flash-lite` behind a strict response schema that
is Zod-parsed anyway, two retries with backoff, the full response kept in `ai_raw`, and
per-card confidence badges on the Review & Edit screen. Tagging runs at concurrency 2
so cards fill in while you are still reading the first one. Every failure mode —
budget spent, model down, schema violation — leaves the card blank, editable and
retryable rather than blocking the upload.

Module 07 adds weather: Open-Meteo behind a swappable provider interface, cached per
city per day rather than per user, temperature buckets the recommendation engine keys
on, and degradation to a stale row or to null rather than an error — a weather outage
makes outfits weather-blind, never broken.

Module 08 adds the recommendation engine: a pure function over a context — no database,
no clock, no randomness — scoring colour harmony, formality coherence, thermal fit,
learned colour affinity, recency and novelty, then assembling slots by beam search with
a diversity rule. It is a scaffold by design; module 19 replaces garment selection with
a model after the test run and keeps this as the fallback, which is only possible
because it stays pure.

Module 09 adds outfits and the planner: one endpoint for both ways an outfit is made
(saving a recommendation, or building one by hand), a saved-outfits list, and a month
calendar that renders in two queries rather than 124. Planning stores an intent for a
date, not a forecast for it.

Module 10 adds feedback and learning: thumbs and "Wore this" on outfits, "Wore Today"
on every item card, and a style profile that shifts future recommendations. The whole
learning system is an exponentially-weighted running average in a JSONB column — the
personalisation is real and it is arithmetic, and the second half of that is not a
weakness. Three thumbs-down on the same colour pairing becomes a hard veto, visible and
clearable under Settings → Style.

The dashboard closes L3: recently added items, Today's Weather Outfit with the
forecast as its default and a manual override on top, and Style Insights — most worn
category, wardrobe diversity, never worn. Every screen in the nav is now real.

Module 11 adds the rerank layer: one model call per user, style and day turns the eight
outfits the rules engine already validated into a ranked five with a sentence worth
reading. It cannot invent a garment, because it only ever picks among outfits built
from the wardrobe. Every failure — free plan, spent budget, model outage, unparseable
response — silently keeps the rules order and its mechanical rationale. Chat is
deferred; see below.

Module 17 adds cost per wear, framed as progress toward a target the user set and never
as a verdict on a purchase. Module 18 adds wear and tear — a condition log that is a
time series, built now because it cannot be retrofitted: "this jacket started failing at
20 wears" only exists if condition was recorded at 5, 10 and 20. It pays off as retailer
durability, the user's own record of where their clothes last.

Module 16's polish pass closes L4: loading skeletons, an error boundary with a working
retry, a 404, the quota screen, custom categories, and the Appearance settings that were
promised with nothing behind them.

Module 19 swaps garment SELECTION to the model and keeps module 08 as the fallback. The
model returns ids and every one is checked against the candidate set it was sent — an
outfit naming a garment the user does not own is discarded, never repaired. It runs
behind a per-user flag so the two engines can be compared on thumbs-up rate before
either is deleted.

Module 13 adds billing: a signature-verified Razorpay webhook that is the only writer of
`profiles.plan`, and a downgrade that archives the excess and deletes nothing. It is
dormant — no keys, no checkout, no caps — and stays that way until you decide to charge.

Module 14 adds observability: one events table, a scrubber that keeps image URLs and
free text out of it, Sentry with the same rules, and four queries in `docs/queries.sql`.
No dashboard, deliberately.

## Running it

Against a **cloud Supabase project** — no local stack, no Docker.

```bash
pnpm install
cp .env.local.example .env.local   # fill in the three Supabase values
pnpm dev
```

Apply `supabase/migrations/*.sql` in filename order, 0001 through 0016:

```bash
pnpm supabase db push
```

Each runs once, in order — 0002 depends on 0001's tables, 0003 on 0002's, and so on.

`supabase/config.toml` and `supabase/seed.sql` exist for the CLI. Neither is required
for the cloud path; the seed is the test-phase `plan = 'premium'` update from module
03 §7, which you can run by hand once the testers have accounts.

Without a `.env.local`, `lib/env.ts` fails loudly at startup. That is the intended
behaviour, not a bug.

## Checks

```bash
pnpm check                     # typecheck, lint, tests, and every offline guard
```

Individually:

```bash
pnpm check:selectstar          # no select('*') anywhere
pnpm check:budget              # every Gemini call site calls assertBudget
pnpm check:storage             # only lib/storage*.ts knows the storage provider
pnpm check:tagschema           # the tagger fills no user-entered field
pnpm check:events              # every event name has exactly one emitter
pnpm check:schema              # every column the code selects exists on the database
SUPABASE_DB_URL=… pnpm check:rls
SUPABASE_DB_URL=… pnpm check:downgrade
pnpm build && pnpm check:leak  # no server secret in .next/static
```

CI runs all of these on every PR and fails the build rather than warning. Each guards a
failure that is invisible in code review: a table without RLS is a data breach, a
`select('*')` is egress, an unguarded model call is a bill, a leaked service-role key is
everything at once, a tagger that guesses at condition corrupts the retailer signal
silently, an event name with no emitter reads as "nobody did that", and a column the
database does not have is a 500 that typecheck, lint, tests and build all pass through.

## Layout

```
app/(auth)/      login, OAuth + magic-link callback
app/(app)/       the authenticated shell and its six destinations
app/api/         mutations, AI calls, health, account export/delete
components/      shell and design-system components
lib/             all logic — pure where possible, unit-testable without a browser
lib/supabase/    client (browser) · server (RSC + routes) · admin (service role)
supabase/        migrations, seed, local config
scripts/         the CI guards
types/           copy of wardrobe-ai-spec/types.ts — the single source of truth
docs/            test → production checklist
```

## Six things that are expensive to retrofit

Repeated from the spec because they are load-bearing here, not aspirational:

1. **RLS on every table from the first migration.** The anon key ships in the browser
   bundle; RLS *is* the authorisation layer. `scripts/rls-check.sql` fails the build if
   a public table ever loses it.
2. **Images compressed client-side, uploaded direct to storage.** You cannot
   re-compress photos you received at 4 MB. `lib/storage.ts` is the only file that
   knows the provider, and the DB holds paths, not URLs.
3. **The recommendation engine is a pure function over its context.** That is what lets
   module 19 swap garment selection to a model with no migration.
4. **Vercel Pro before any payment goes live.** Hobby's fair-use policy forbids
   commercial use, donations included.
5. **Condition tracking from day one.** It is a time series; added later, every garment
   bought before that day has no history and never can.
6. **`slot` and `category` are separate axes.** Slots are the fixed internal enum the
   outfit engine assembles on; categories are the user-extensible table the UI shows.
