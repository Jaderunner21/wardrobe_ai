-- CI step 4 — RLS coverage (module 02 section 1).
--
-- The Supabase anon key is public and ships in the browser bundle. RLS is the
-- authorisation layer. A table with RLS forgotten is not a bug, it is a full data
-- breach. weather_cache is the single exception: global and read-only to clients.
--
-- WHERE THIS ACTUALLY EARNS ITS KEEP. A hosted Supabase project force-enables RLS on
-- new tables in `public`, so the failure this guards against is hard to reach there —
-- verified by creating a bare table on the live database and finding `relrowsecurity`
-- already true. CI runs STOCK Postgres, which has no such default, and that is where a
-- migration missing its `enable row level security` gets caught.
--
-- Note the distinction this query draws. RLS *enabled with no policy* is a safe,
-- deny-all state and passes — `processed_webhooks` (0014) depends on exactly that.
-- RLS *disabled* is a table the public anon key can read, and fails.
--
-- Any row returned here fails the build.
select t.tablename
  from pg_tables t
  join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public'
   and c.relnamespace = 'public'::regnamespace
   and t.tablename <> 'weather_cache'
   and not c.relrowsecurity;
