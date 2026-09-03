-- Module 13 §3 — what actually survives a downgrade.
--
-- "Archive the excess, never delete it. Keep the 25 most recently worn (then most
-- recently added) active; archive the rest."
--
-- This runs `downgrade_to_free()` for real, against real rows, inside a transaction that
-- is rolled back. The alternative — a TypeScript function that describes the same rule
-- and is never called by anything — is a copy that drifts from the SQL the moment either
-- is edited, and the drift is invisible because both "pass".
--
-- Every assertion raises, so ON_ERROR_STOP turns a wrong answer into a failed build.

begin;

-- A cap to enforce. The live configuration has item_cap null on both plans, which is
-- why the downgrade currently archives nothing; this sets one so the rule can be tested.
update plan_features set item_cap = 3 where plan = 'free';

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'downgrade-test@example.com');

/*
 * `on conflict` because this script has to run in two places that differ. On a real
 * Supabase database the `handle_new_user` trigger (0006) has ALREADY created this
 * profile by the time we get here; in CI, `auth.users` is a bare stub table with no
 * trigger and the row does not exist. A plain insert works in exactly one of the two,
 * and the first run of this script against the live database is how I found that out.
 */
insert into profiles (id, plan) values
  ('00000000-0000-4000-8000-000000000001', 'premium')
on conflict (id) do update set plan = 'premium';

-- Six garments: two worn recently, two worn long ago, two never worn. With a cap of 3
-- the two recently worn and the newest of the rest should survive.
insert into items (id, user_id, status, storage_path, thumb_path, last_worn_on, created_at)
values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
   'ready', 'items/u/1.webp', 'items/u/1_t.webp', current_date - 1,  now() - interval '400 days'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001',
   'ready', 'items/u/2.webp', 'items/u/2_t.webp', current_date - 5,  now() - interval '300 days'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001',
   'ready', 'items/u/3.webp', 'items/u/3_t.webp', current_date - 900, now() - interval '200 days'),
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001',
   'ready', 'items/u/4.webp', 'items/u/4_t.webp', current_date - 950, now() - interval '100 days'),
  ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000001',
   'ready', 'items/u/5.webp', 'items/u/5_t.webp', null,               now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001',
   'ready', 'items/u/6.webp', 'items/u/6_t.webp', null,               now() - interval '1 day');

do $$
declare
  archived_count int;
  live_count     int;
  total_count    int;
begin
  archived_count := downgrade_to_free('00000000-0000-4000-8000-000000000001');

  -- Six items, cap of three: three archived.
  if archived_count <> 3 then
    raise exception 'expected 3 archived, got %', archived_count;
  end if;

  select count(*) into live_count from items
   where user_id = '00000000-0000-4000-8000-000000000001' and not archived;
  if live_count <> 3 then
    raise exception 'expected 3 active items, got %', live_count;
  end if;

  -- NOTHING IS DELETED. This is the assertion the module exists for.
  select count(*) into total_count from items
   where user_id = '00000000-0000-4000-8000-000000000001' and deleted_at is null;
  if total_count <> 6 then
    raise exception 'downgrade deleted items: expected 6 rows, found %', total_count;
  end if;

  -- The two most recently worn survive.
  if (select archived from items where id = '00000000-0000-4000-8000-000000000011') then
    raise exception 'archived the most recently worn item';
  end if;
  if (select archived from items where id = '00000000-0000-4000-8000-000000000012') then
    raise exception 'archived the second most recently worn item';
  end if;

  -- A never-worn item is archived even though it is the newest thing in the wardrobe.
  if not (select archived from items where id = '00000000-0000-4000-8000-000000000016') then
    raise exception 'kept a never-worn item over one that is actually worn';
  end if;
end $$;

-- Idempotent: running it again finds nothing left to archive.
do $$
declare
  second_run int;
begin
  second_run := downgrade_to_free('00000000-0000-4000-8000-000000000001');
  if second_run <> 0 then
    raise exception 'second downgrade archived % more items', second_run;
  end if;
end $$;

-- With no cap configured — the live test-phase state — the downgrade does nothing.
do $$
declare
  archived_count int;
begin
  update plan_features set item_cap = null where plan = 'free';
  update items set archived = false
   where user_id = '00000000-0000-4000-8000-000000000001';

  archived_count := downgrade_to_free('00000000-0000-4000-8000-000000000001');
  if archived_count <> 0 then
    raise exception 'archived % items with no cap configured', archived_count;
  end if;
end $$;

rollback;
