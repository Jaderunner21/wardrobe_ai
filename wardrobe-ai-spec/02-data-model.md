# 02 — Data model

**Scope:** TEST · **Depends on:** 01 · **Owns:** `supabase/migrations/*`, `lib/mappers.ts`

## Responsibility

Own the entire database schema, its invariants, and the Postgres → TypeScript mapping. No
other module writes DDL. A module that needs a new column opens a migration here.

## Contracts

`schema.sql` in this folder is the complete DDL. It has been applied to Postgres 16 and the
invariants below were tested against a live instance. Copy it verbatim to
`supabase/migrations/0001_init.sql`.

Tables and their owning modules:

| Table | Owner | Notes |
|---|---|---|
| `profiles` | 03 | `item_count` is denormalised, maintained by trigger |
| `style_profiles` | 10 | rewritten in place; never grows |
| `items` | 05 | the hot table |
| `outfits`, `outfit_items` | 09 | |
| `feedback` | 10 | append-only |
| `recommendation_cache` | 08 | GC'd by cron (PROD) |
| `weather_cache` | 07 | global, not per-user |
| `ai_usage` | 12 | checked before every model call |
| `ai_jobs` | 06 | retry lane; PROD only |
| `events` | 14 | 30-day retention |

## Behaviour

### 1. RLS is not optional

Every table in `public` has RLS enabled with a `user_id = auth.uid()` policy.
`weather_cache` is the single exception — it is global and read-only to clients.

This matters more here than in a conventional app: the Supabase anon key is public and ships
in the browser bundle. **RLS is the authorisation layer.** A table with RLS forgotten is not
a bug, it is a full data breach. Hence the CI check below, which runs on every build:

```sql
-- fails the build if any row comes back
select tablename from pg_tables t
  join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public'
   and t.tablename <> 'weather_cache'
   and not c.relrowsecurity;
```

### 2. The item quota trigger

Free plan is capped at `FREE_ITEM_CAP` (25) items. Enforced in the database, because a bug
in a route handler or a direct PostgREST call must not be able to get past it.

The `for update` row lock is load-bearing. Without it, ten concurrent uploads from a bulk
import each read `item_count = 24` and all ten succeed.

Verified behaviour (tested against Postgres 16):

- 25 inserts on a `free` profile succeed; `item_count` reads 25
- the 26th raises `ITEM_QUOTA_EXCEEDED`
- after `plan = 'premium'`, the same insert succeeds and `item_count` reads 26
- deleting an item decrements the counter
- inserting a second item with an existing `content_hash` for the same user violates
  `items_dedupe_idx`

### 3. Column selection discipline

`items` carries an `ai_raw` JSONB column holding the full model response. No list view needs
it. `ITEM_LIST_COLUMNS` in `types.ts` is the allowed list for grids and pickers.

This is not micro-optimisation. At production scale, `select('*')` on the wardrobe grid takes
Supabase egress from 1.29 GB/month to 4.29 GB against a 5 GB free ceiling. At 15 users it is
invisible, which is exactly why the habit has to be built now.

### 4. Retention

`events` is the only unbounded table that isn't user-value data, and it is over half the
projected headroom at production scale. The `pg_cron` job that deletes rows older than
30 days is what keeps the database under 500 MB.

**Test phase:** leave the cron statements in the migration but commented. There is nothing
to collect at 15 users, and an unexplained scheduled delete is worse than no scheduled
delete. Uncomment at production.

### 5. Mapping

One mapper pair per table, in `lib/mappers.ts`:

```ts
export const toItem = (r: ItemRow): Item => ({
  id: r.id,
  userId: r.user_id,
  storagePath: r.storage_path,
  thumbPath: r.thumb_path,
  contentHash: r.content_hash,
  primaryColor: r.primary_color,
  colorHex: r.color_hex,
  secondaryColors: r.secondary_colors ?? [],
  aiConfidence: r.ai_confidence,
  aiModel: r.ai_model,
  userEdited: r.user_edited,
  userTags: r.user_tags ?? [],
  wearCount: r.wear_count,
  lastWornOn: r.last_worn_on,
  createdAt: r.created_at,
  // ...identical-name fields pass through
});
```

No runtime case-converter. A generic `snakeToCamel` is untyped, invisible to grep, and
silently mangles `storage_path` into `storagePath` on a good day and `storagepath` on a bad one.

### 6. Migrations only

Every schema change is a file in `supabase/migrations/`, applied via the Supabase CLI, and
committed. Never the dashboard SQL editor. The first time production and local diverge with
no migration recording it, you own a mystery instead of a database.

## Acceptance

- [ ] `0001_init.sql` applies cleanly to an empty Postgres 16
- [ ] the RLS CI query returns zero rows and is wired into the build
- [ ] quota trigger: all five behaviours in §2 verified by an integration test
- [ ] `lib/mappers.ts` covers every table read by the app, typed against `types.ts`
- [ ] no `select('*')` anywhere in the codebase (grep in CI)
- [ ] cron statements present but commented, with a note pointing at module 15

## Out of scope

- Business logic in triggers beyond the quota and counter. Everything else is application
  code, where it can be tested and read.
- Any table not listed above. New tables need a reason and an owning module.
