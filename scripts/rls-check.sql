-- CI step 4 — RLS coverage (module 02 section 1).
--
-- The Supabase anon key is public and ships in the browser bundle. RLS is the
-- authorisation layer. A table with RLS forgotten is not a bug, it is a full data
-- breach. weather_cache is the single exception: global and read-only to clients.
--
-- Any row returned here fails the build.
select t.tablename
  from pg_tables t
  join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public'
   and c.relnamespace = 'public'::regnamespace
   and t.tablename <> 'weather_cache'
   and not c.relrowsecurity;
