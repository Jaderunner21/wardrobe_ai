# Wardrobe AI

Photograph a garment once; the model files it, and the app dresses you from what you
actually own.

The specification lives in [`wardrobe-ai-spec/`](wardrobe-ai-spec/README.md) and is the
authority for data model and behaviour. This README covers only how to run what is
built.

## Status — L0 (Foundation) complete

```
L0  Foundation      01 → 02 → 03 → 16(tokens+shell) → 15(deploy pipeline, env)   ← here
L1  Wardrobe core   04 → 05 → 16(wardrobe, upload, bin)
L2  Tagging         12 → 06
L3  Recommendations 07 → 08 → 09 → 10 → 16(dashboard, outfits)
L4  AI + polish     11 → 17 → 18 → 16(states, mobile)     ── test run ──
L5  AI ENGINE       19
L6  Production      13 → 14(full) → 15(full)
```

What exists: the six migrations, all three Supabase clients, session middleware and
route protection, email-OTP and Google sign-in, the design tokens with a working dark
mode, the shell (desktop top bar + mobile tab bar), account export and deletion,
`/api/health`, and CI with all eight gates.

Wardrobe, upload, outfits and bin are placeholder screens that name the module which
fills them in. That is deliberate — L1's gate is "your own wardrobe lives in it", and
nothing before that gate should pretend to.

## Running it

```bash
pnpm install
cp .env.example .env.local     # fill in the Supabase values
supabase start                 # local Postgres + auth + storage
supabase db reset              # applies supabase/migrations/*, then seed.sql
pnpm dev
```

Without a `.env.local`, `lib/env.ts` fails loudly at startup. That is the intended
behaviour, not a bug.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm check:selectstar          # no select('*') anywhere
pnpm check:budget              # every Gemini call site calls assertBudget
SUPABASE_DB_URL=… pnpm check:rls
pnpm build && pnpm check:leak  # no server secret in .next/static
```

CI runs all eight on every PR and fails the build rather than warning. Four of them
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
