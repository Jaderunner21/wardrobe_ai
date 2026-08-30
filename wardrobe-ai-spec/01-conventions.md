# 01 — Conventions

**Scope:** TEST · **Depends on:** — · **Owns:** repo layout, error model, lint/test config

Read before writing any code. Every other module assumes these.

## Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js, App Router | 15.x |
| Language | TypeScript, `strict: true` | 5.x |
| Styling | Tailwind CSS | 4.x |
| Database | Postgres via Supabase | 15+ |
| Auth | Supabase Auth | — |
| Object storage | Supabase Storage (private bucket) | — |
| AI | Google Gemini 2.5 Flash-Lite | — |
| Hosting | Vercel | — |
| Package manager | pnpm | — |

No ORM. Use the Supabase JS client with explicit column selection. An ORM would hide the
`select` list, and the `select` list is what keeps egress inside the free tier (see 02).

## Repo layout

```
app/
  (auth)/
    login/page.tsx
    callback/route.ts
  (app)/
    layout.tsx                  # authenticated shell, nav
    wardrobe/page.tsx
    wardrobe/[id]/page.tsx
    outfits/page.tsx
    planner/page.tsx
    chat/page.tsx
    settings/page.tsx
  api/
    items/route.ts              # GET list, POST create
    items/[id]/route.ts         # GET, PATCH, DELETE
    items/presign/route.ts      # POST
    items/tag/route.ts          # POST
    recommendations/route.ts    # GET
    outfits/route.ts            # POST save
    outfits/[id]/route.ts       # PATCH, DELETE
    feedback/route.ts           # POST
    chat/route.ts               # POST, streams
    weather/route.ts            # GET
    account/export/route.ts     # GET
    account/route.ts            # DELETE
    health/route.ts             # GET
    webhooks/razorpay/route.ts  # POST  (module 13, PROD)
  layout.tsx
  globals.css
lib/
  supabase/client.ts            # browser client
  supabase/server.ts            # RSC + route handler client
  supabase/admin.ts             # service-role client — server only, never imported by a client component
  storage.ts                    # signed upload/read URLs, delete — the ONLY file
                                #   that knows which storage provider is in use
  gemini.ts                     # model calls, schema enforcement
  budget.ts                     # AI quota checks (12)
  weather.ts                    # (07)
  recommender/
    index.ts                    # entry: recommend(ctx) → Recommendation[]
    color.ts                    # hex → HSL, harmony scoring
    score.ts                    # pair scoring terms
    beam.ts                     # slot assembly
  image.ts                      # CLIENT ONLY — resize, WebP encode, hash
  events.ts                     # analytics writes (14)
  errors.ts                     # AppError, error codes
types/
  index.ts                      # copy of spec/types.ts — single source of truth
supabase/
  migrations/
    0001_init.sql               # = spec/schema.sql
```

**Rule:** a file under `lib/` that imports `lib/supabase/admin.ts` must have no path to a
client component. Enforce with `import 'server-only'` at the top of every such file.

## Error model

One shape for every API failure. Never return a bare string, never a 500 with a stack trace.

```ts
// lib/errors.ts
export type ErrorCode =
  | 'UNAUTHENTICATED'      // 401 no session
  | 'FORBIDDEN'            // 403 authenticated but not permitted
  | 'NOT_FOUND'            // 404
  | 'VALIDATION_FAILED'    // 400 bad request body; include `fields`
  | 'ITEM_QUOTA_EXCEEDED'  // 409 free plan at 25 items → show upgrade
  | 'DUPLICATE_ITEM'       // 409 content_hash collision
  | 'PREMIUM_REQUIRED'     // 402 feature is premium-only
  | 'AI_BUDGET_EXCEEDED'   // 429 per-user daily AI cap hit
  | 'AI_UNAVAILABLE'       // 503 upstream model failed after retries
  | 'RATE_LIMITED'         // 429
  | 'INTERNAL';            // 500

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) { super(message); }
}
```

Every route handler returns either the success body or:

```json
{ "error": { "code": "ITEM_QUOTA_EXCEEDED", "message": "Free plan is limited to 25 items.", "fields": null } }
```

Client code switches on `code`, never on `message`. Messages are user-facing copy and will
change; codes are the contract.

**Postgres exceptions map to codes.** The quota trigger raises `ITEM_QUOTA_EXCEEDED`; catch
it by matching the message and translate. The dedupe index raises code `23505` on
constraint `items_dedupe_idx`; translate to `DUPLICATE_ITEM`.

## Naming

| Thing | Convention | Example |
|---|---|---|
| DB tables & columns | `snake_case`, plural tables | `style_profiles`, `last_worn_on` |
| TypeScript | `camelCase` fields, `PascalCase` types | `lastWornOn`, `StyleProfile` |
| Route files | Next.js convention | `app/api/items/[id]/route.ts` |
| React components | `PascalCase.tsx` | `WardrobeGrid.tsx` |
| Env vars | `SCREAMING_SNAKE` | `SUPABASE_SERVICE_ROLE_KEY` |

**Mapping is explicit.** Write `toItem(row)` / `toItemRow(item)` in one place per table
(`lib/mappers.ts`). Do not sprinkle `snake_case` through React components and do not add a
runtime case-converter — an explicit mapper is greppable and typed.

## Data fetching

1. **Lists render on the server.** The wardrobe grid, outfit list, and planner are React
   Server Components that query Supabase directly. This is not a preference — shipping HTML
   instead of JSON is what keeps Supabase egress inside 5 GB at production scale.
2. **Never `select('*')`.** `items` has an `ai_raw` JSONB column that no list view needs.
   Declare the columns. Every module's spec names the exact list view columns.
3. **Route handlers are for mutations and AI calls**, not for feeding the initial render.
4. **Client components fetch only for interaction** — filtering, pagination beyond page 1,
   chat streaming.

## Validation

Zod at every trust boundary: request bodies, Gemini responses, webhook payloads. Define
schemas next to the route that uses them. Infer TypeScript types from the Zod schema rather
than declaring both.

## Testing

Minimum bar. Not comprehensive coverage — the things that are cheap to test and expensive to
get wrong.

| What | How | Why |
|---|---|---|
| Recommendation scoring | unit, pure functions, fixture wardrobes | the only real algorithm in the codebase |
| Colour harmony | unit, table of known pairs | easy to get subtly wrong, invisible in review |
| Quota trigger | integration against a real Postgres | already written; see 02 |
| RLS coverage | CI query, fails build if any public table lacks RLS | a miss here is a data breach |
| Error mapping | unit, PG error → ErrorCode | silent wrong status codes otherwise |
| Gemini response parsing | unit, against recorded fixtures | do not call the live API in tests |

Never call Gemini, storage, or the weather API in tests. Record fixtures once, replay them.

## Environment variables

```
# public — bundled into client JS
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY

# server only — never prefixed NEXT_PUBLIC_
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
CRON_SECRET
SENTRY_DSN
RAZORPAY_KEY_ID                   # module 13, PROD
RAZORPAY_KEY_SECRET               # module 13, PROD
```

Validate all of them at startup in `lib/env.ts` with Zod and fail loudly. A missing key
should crash the build, not surface as a 500 in production at 2am.

## Things not to do

- No `any`. `unknown` plus a Zod parse instead.
- No client-side use of the service-role key, in any form, for any reason.
- No business logic in React components. Logic lives in `lib/`, is pure where possible, and
  is unit-testable without a browser.
- No writing to another module's tables. Route it through the owner.
- No dashboard SQL. Every schema change is a migration file in `supabase/migrations/`.
