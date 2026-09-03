# Wardrobe AI

Photograph a garment once; the model files it, and the app dresses you from what you
actually own.

The specification lives in [`wardrobe-ai-spec/`](wardrobe-ai-spec/README.md) and is the
authority for data model and behaviour. This README covers only how to run what is
built.

## Status — L0-L2 code complete, L3 in progress (modules 07, 08, 09)

```
L0  Foundation      01 → 02 → 03 → 16(tokens+shell) → 15(deploy pipeline, env)   ✓
L1  Wardrobe core   04 ✓ → 05 ✓ → 16(wardrobe, upload, bin) ✓                     ← gate
L2  Tagging         12 ✓ → 06 ✓                                                  ← gate
L3  Recommendations 07 ✓ → 08 ✓ → 09 ✓ → 10 → 16(dashboard, outfits)             ← here
L4  AI + polish     11 → 17 → 18 → 16(states, mobile)     ── test run ──
L5  AI ENGINE       19
L6  Production      13 → 14(full) → 15(full)
```

What exists: the six migrations, all three Supabase clients, session middleware and
route protection, email-OTP and Google sign-in, the design tokens with a working dark
mode, the shell (desktop top bar + mobile tab bar), account export and deletion,
`/api/health`, and CI with all eight gates. Module 04 adds a ninth: the storage boundary.

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

Module 06 adds tagging: `gemini-2.5-flash-lite` behind a strict response schema that
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

The dashboard is still a placeholder naming the module that fills it in. L1's gate is "your own wardrobe lives in it" — that needs a database, so it is not
passed until the migrations are applied and real items go in.

## Running it

Against a **cloud Supabase project** — no local stack, no Docker.

```bash
pnpm install
cp .env.local.example .env.local   # fill in the three Supabase values
pnpm dev
```

Apply `supabase/migrations/*.sql` to the project in filename order, 0001 through
0006. Every one is idempotent-safe to run once and only once, in order — 0002 depends
on 0001's tables, 0003 on 0002's, and so on.

`supabase/config.toml` and `supabase/seed.sql` exist for the CLI. Neither is required
for the cloud path; the seed is the test-phase `plan = 'premium'` update from module
03 §7, which you can run by hand once the testers have accounts.

Without a `.env.local`, `lib/env.ts` fails loudly at startup. That is the intended
behaviour, not a bug.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm check:selectstar          # no select('*') anywhere
pnpm check:budget              # every Gemini call site calls assertBudget
pnpm check:storage             # only lib/storage*.ts knows the storage provider
SUPABASE_DB_URL=… pnpm check:rls
pnpm build && pnpm check:leak  # no server secret in .next/static
```

CI runs all of these on every PR and fails the build rather than warning. Four of them
guard failures that are invisible in code review: a table without RLS is a data
breach, a `select('*')` is egress, an unguarded model call is a bill, and a leaked
service-role key is everything at once.

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
