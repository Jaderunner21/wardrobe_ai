-- 0010_admin_and_plan_features.sql
-- An admin role, and per-plan entitlements that live in the database rather than in a
-- TypeScript constant.
--
-- Two things this makes possible that were not before:
--
--   1. Changing what a plan includes without a deploy. `AI_LIMITS` in types.ts is a
--      compile-time constant; an operator cannot open up chat for everyone at 9pm
--      without a code change and a build.
--   2. An operator surface at all. There was no notion of "admin" anywhere in the
--      schema, so there was nobody who could be trusted to see another user's row.
--
-- FOR NOW EVERY PLAN GETS EVERYTHING. The seed below gives free and premium identical
-- entitlements, which is the requested test-phase posture. The columns are what make
-- narrowing that later a row update instead of a migration.

begin;

-- ═══════════════════════════════════════════ 1. who is an admin

alter table profiles add column is_admin boolean not null default false;

-- Used by RLS policies below. SECURITY DEFINER so the policy can read `profiles`
-- without recursing into the policy that protects `profiles`.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false)
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- An admin may read and update any profile. Ordinary users keep the own-row policy
-- from 0001; policies are OR-ed, so this widens access for admins only.
create policy admin_reads_profiles on profiles
  for select using (is_admin());

create policy admin_updates_profiles on profiles
  for update using (is_admin()) with check (is_admin());

-- ═══════════════════════════════════════════ 2. per-plan entitlements

create table plan_features (
  plan          plan_t primary key,
  -- Daily AI call ceilings. 0 means the plan does not have that feature at all, which
  -- the app reports as PREMIUM_REQUIRED rather than "come back tomorrow" (module 12 §5).
  tag_limit     int not null default 40  check (tag_limit    >= 0),
  chat_limit    int not null default 0   check (chat_limit   >= 0),
  rerank_limit  int not null default 0   check (rerank_limit >= 0),
  -- Live items allowed. NULL means unlimited.
  item_cap      int check (item_cap is null or item_cap >= 0),
  updated_at    timestamptz not null default now()
);

-- Test-phase posture: both plans get everything, and nothing is capped.
insert into plan_features (plan, tag_limit, chat_limit, rerank_limit, item_cap) values
  ('free',    100, 50, 50, null),
  ('premium', 100, 50, 50, null);

alter table plan_features enable row level security;

-- Everyone needs to read their own entitlements; only an admin may change them.
create policy plan_features_read on plan_features
  for select using (auth.uid() is not null);

create policy plan_features_admin_write on plan_features
  for all using (is_admin()) with check (is_admin());

-- ═══════════════════════════════════════════ 3. the quota trigger reads the table

-- Replaces the version in 0002, which hardcoded 25 for the free plan. Behaviour is
-- unchanged except that the cap now comes from plan_features, and a NULL cap means
-- unlimited.
create or replace function enforce_item_quota() returns trigger
language plpgsql security definer as $$
declare
  cur_plan   plan_t;
  cap        int;
  live_count int;
begin
  select plan into cur_plan from profiles where id = new.user_id for update;

  select item_cap into cap from plan_features where plan = cur_plan;

  select count(*) into live_count
    from items where user_id = new.user_id and deleted_at is null;

  if cap is not null and live_count >= cap then
    raise exception 'ITEM_QUOTA_EXCEEDED' using errcode = 'check_violation';
  end if;

  update profiles
     set item_count       = live_count + 1,
         wardrobe_version = wardrobe_version + 1
   where id = new.user_id;
  return new;
end $$;

commit;
