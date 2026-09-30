-- Function hardening — clears the Security Advisor findings.
--
-- 1. EXECUTE grants. Supabase grants EXECUTE on every new public function directly to
--    `anon` and `authenticated` (not via PUBLIC), so the `revoke ... from public` lines
--    in earlier migrations never actually closed anything. Every SECURITY DEFINER
--    function was callable at /rest/v1/rpc/<name> with only the public anon key —
--    including apply_plan, which meant anyone could set any account to premium, and
--    gc_outfits / downgrade_to_free, which delete or archive other users' data.
--
--    Three groups:
--      trigger functions  → nobody. Postgres does not check EXECUTE when a trigger fires.
--      service-role jobs  → service_role only (webhook, cron).
--      user RPCs          → authenticated only. Each one scopes itself by auth.uid().
--
-- 2. search_path. A SECURITY DEFINER function with a mutable search_path can be
--    hijacked by a caller who puts a same-named object earlier on the path. Pin it.
--
-- 3. pg_net lives in `public`. Nothing uses it yet (the ai_jobs drain is commented
--    out), so move it to `extensions` now while that is free.

begin;

-- ═══════════════════════════════════════════ search_path

alter function enforce_item_quota()                          set search_path = public;
alter function decrement_item_count()                        set search_path = public;
alter function bump_wardrobe_version()                       set search_path = public;
alter function rate_condition(uuid, smallint, text)          set search_path = public;
alter function needs_condition_rating(items)                 set search_path = public;
alter function log_wear(uuid, date)                          set search_path = public;
alter function undo_wear(uuid, date)                         set search_path = public;
alter function set_wear_count(uuid, int)                     set search_path = public;
alter function wear_confidence(items)                        set search_path = public;
alter function downgrade_to_free(uuid)                       set search_path = public;
alter function apply_plan(uuid, plan_t, timestamptz, text)   set search_path = public;
alter function downgrade_expired()                           set search_path = public;
alter function gc_outfits(int)                               set search_path = public;
alter function orphaned_objects()                            set search_path = public, storage;

-- ═══════════════════════════════════════════ trigger functions: nobody

revoke execute on function enforce_item_quota()    from public, anon, authenticated;
revoke execute on function decrement_item_count()  from public, anon, authenticated;
revoke execute on function bump_wardrobe_version() from public, anon, authenticated;
revoke execute on function handle_new_user()       from public, anon, authenticated;

-- ═══════════════════════════════════════════ service-role jobs

revoke execute on function apply_plan(uuid, plan_t, timestamptz, text) from public, anon, authenticated;
revoke execute on function downgrade_to_free(uuid)                     from public, anon, authenticated;
revoke execute on function downgrade_expired()                         from public, anon, authenticated;
revoke execute on function gc_outfits(int)                             from public, anon, authenticated;
revoke execute on function orphaned_objects()                          from public, anon, authenticated;

grant execute on function apply_plan(uuid, plan_t, timestamptz, text) to service_role;
grant execute on function downgrade_to_free(uuid)                     to service_role;
grant execute on function downgrade_expired()                         to service_role;
grant execute on function gc_outfits(int)                             to service_role;
grant execute on function orphaned_objects()                          to service_role;

-- ═══════════════════════════════════════════ user RPCs: signed-in only

revoke execute on function log_wear(uuid, date)                  from public, anon;
revoke execute on function undo_wear(uuid, date)                 from public, anon;
revoke execute on function set_wear_count(uuid, int)             from public, anon;
revoke execute on function rate_condition(uuid, smallint, text)  from public, anon;
revoke execute on function reserve_ai_call(text, int, date)      from public, anon;
revoke execute on function record_ai_tokens(date, bigint, bigint) from public, anon;
revoke execute on function cache_weather(text, date, jsonb)      from public, anon;
revoke execute on function is_admin()                            from public, anon;

grant execute on function log_wear(uuid, date)                   to authenticated;
grant execute on function undo_wear(uuid, date)                  to authenticated;
grant execute on function set_wear_count(uuid, int)              to authenticated;
grant execute on function rate_condition(uuid, smallint, text)   to authenticated;
grant execute on function reserve_ai_call(text, int, date)       to authenticated;
grant execute on function record_ai_tokens(date, bigint, bigint) to authenticated;
grant execute on function cache_weather(text, date, jsonb)       to authenticated;
grant execute on function is_admin()                             to authenticated;

-- rls_auto_enable is created by the dashboard's "auto-enable RLS" setting, not by a
-- migration, so it may not exist (CI, local). It is an event-trigger helper.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Future functions: no more silent grants to anon. New user RPCs must
-- `grant execute ... to authenticated` explicitly, as the ones above now do.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ═══════════════════════════════════════════ pg_net out of public

do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
              where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;

commit;
