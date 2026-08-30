-- 0004_wear_and_tear.sql
-- Condition tracking. User-rated, never inferred.
--
-- This is the one future feature that is now-or-never. Condition is a TIME SERIES:
-- "this jacket started failing at 20 wears" only exists if condition was recorded at
-- wear 5, 10 and 20. Add this in six months and every garment already in the wardrobe
-- has no history and never will.

begin;

-- Why an item left the wardrobe. Feeds the retailer durability picture and, later,
-- the donation flow.
create type retired_reason_t as enum
  ('worn_out', 'no_longer_fits', 'disliked', 'sold', 'donated', 'lost', 'other');

alter table items
  -- 5 like new · 4 good · 3 worn but fine · 2 visible wear · 1 worn out
  add column condition            smallint check (condition between 1 and 5),
  add column condition_rated_at   timestamptz,
  -- wear_count at the moment of rating. Denormalised on purpose: without it you
  -- cannot say "it was still a 5 at 40 wears" without reconstructing history.
  add column condition_at_wear    int,
  add column retired_reason       retired_reason_t,
  add column retired_at           timestamptz;

-- The time series. One row per rating, never updated, never deleted.
create table condition_log (
  id         bigserial primary key,
  item_id    uuid     not null references items    on delete cascade,
  user_id    uuid     not null references profiles on delete cascade,
  condition  smallint not null check (condition between 1 and 5),
  wear_count int      not null,          -- snapshot at rating time
  note       text,
  created_at timestamptz not null default now()
);

create index condition_log_item_idx on condition_log (item_id, created_at desc);
create index condition_log_user_idx on condition_log (user_id, created_at desc);

alter table condition_log enable row level security;
create policy own_condition_log on condition_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Rating an item writes the log row AND updates the item, in one place, so the two
-- can never disagree.
create or replace function rate_condition(
  p_item_id uuid, p_condition smallint, p_note text default null
) returns items
language plpgsql security definer as $$
declare
  it items;
begin
  select * into it from items where id = p_item_id and user_id = auth.uid();
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into condition_log (item_id, user_id, condition, wear_count, note)
  values (p_item_id, it.user_id, p_condition, it.wear_count, p_note);

  update items
     set condition          = p_condition,
         condition_rated_at = now(),
         condition_at_wear  = wear_count
   where id = p_item_id
  returning * into it;

  return it;
end $$;

-- Prompt for a rating at wear milestones, not every wear. Nagging kills the feature.
create or replace function needs_condition_rating(it items) returns boolean
language sql immutable as $$
  select it.wear_count >= 10
     and (it.condition_at_wear is null
          or it.wear_count - it.condition_at_wear >= 15)
$$;

-- ═══════════════════════════════════════════ retailer durability

-- "Your items from this shop" — the user's OWN record, not a public rating of a
-- business. Needs at least 3 items before it says anything, or one bad shirt
-- condemns a shop.
-- security_invoker: the view runs with the CALLER's permissions, so RLS on `items`
-- applies inside it. Without this, Postgres 15+ runs views as their creator and a
-- user could query another user's purchase history through the view.
create or replace view retailer_durability
  with (security_invoker = true) as
select
  i.user_id,
  i.retailer,
  count(*)                                          as items,
  round(avg(i.wear_count)::numeric, 1)              as avg_wears,
  round(avg(i.price)::numeric, 2)                   as avg_price,
  round(avg(i.cost_per_wear)::numeric, 2)           as avg_cost_per_wear,
  round(avg(i.condition)::numeric, 2)               as avg_condition,
  -- wears at which an item first dropped to "visible wear" or worse
  round(avg(cl.first_decline_wear)::numeric, 1)     as avg_wears_to_decline,
  count(*) filter (where i.retired_reason = 'worn_out') as worn_out_count
from items i
left join lateral (
  select min(wear_count) as first_decline_wear
    from condition_log
   where item_id = i.id and condition <= 2
) cl on true
where i.retailer is not null and i.deleted_at is null
group by i.user_id, i.retailer
having count(*) >= 3;

commit;
