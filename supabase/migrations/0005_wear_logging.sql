-- 0005_wear_logging.sql
-- Wear count is the user's number, not ours. Three things this fixes:
--
--   1. Digitising an old wardrobe. A jacket you have owned for two years starts at
--      0 wears, which makes its cost-per-wear wrong and its condition history
--      meaningless. Ask for a starting estimate.
--   2. Forgetting to log. Nobody taps every day. Let them set the number directly
--      or backdate a wear they missed.
--   3. Mis-taps. One tap should be undoable.

begin;

alter table items
  -- What the user estimated when they added the item, before any logging.
  -- Kept separately so you can tell a measured 40 from a guessed 40.
  add column initial_wear_count int not null default 0
    check (initial_wear_count >= 0);

alter table items
  add constraint items_wear_count_nonneg check (wear_count >= 0);

-- Wears are recorded as feedback rows (kind = 'worn'). Adding a date lets a user
-- log a wearing that happened on a day they forgot to open the app.
alter table feedback
  add column worn_on date;

create index feedback_worn_idx on feedback (item_id, worn_on desc)
  where kind = 'worn';

-- ═══════════════════════════════════════════ log a wear

-- Idempotent per (item, day): tapping twice on the same date does not double-count.
create or replace function log_wear(p_item_id uuid, p_worn_on date default null)
returns items
language plpgsql security definer as $$
declare
  it   items;
  day  date;
  tz   text;
begin
  select * into it from items where id = p_item_id and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;
  select timezone into tz from profiles where id = it.user_id;

  day := coalesce(p_worn_on, (now() at time zone tz)::date);
  if day > (now() at time zone tz)::date then
    raise exception 'VALIDATION_FAILED: cannot log a wear in the future';
  end if;

  if exists (select 1 from feedback
              where item_id = p_item_id and kind = 'worn' and worn_on = day) then
    return it;                                   -- already logged for that day
  end if;

  insert into feedback (user_id, item_id, kind, worn_on)
  values (it.user_id, p_item_id, 'worn', day);

  update items
     set wear_count   = wear_count + 1,
         last_worn_on = greatest(coalesce(last_worn_on, day), day)
   where id = p_item_id
  returning * into it;

  return it;
end $$;

-- ═══════════════════════════════════════════ undo a wear

create or replace function undo_wear(p_item_id uuid, p_worn_on date default null)
returns items
language plpgsql security definer as $$
declare
  it  items;
  day date;
  tz  text;
  del int;
begin
  select * into it from items where id = p_item_id and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;
  select timezone into tz from profiles where id = it.user_id;

  day := coalesce(p_worn_on, (now() at time zone tz)::date);

  delete from feedback
   where item_id = p_item_id and kind = 'worn' and worn_on = day;
  get diagnostics del = row_count;

  if del > 0 then
    update items
       set wear_count   = greatest(wear_count - del, 0),
           last_worn_on = (select max(worn_on) from feedback
                            where item_id = p_item_id and kind = 'worn')
     where id = p_item_id
    returning * into it;
  end if;

  return it;
end $$;

-- ═══════════════════════════════════════════ set the count directly

-- For "I've worn this about 80 times" — on an item added years after it was bought,
-- or to correct a count that drifted. Logged wears are preserved; the difference
-- lands in initial_wear_count so the two remain distinguishable.
create or replace function set_wear_count(p_item_id uuid, p_count int)
returns items
language plpgsql security definer as $$
declare
  it     items;
  logged int;
begin
  if p_count < 0 then raise exception 'VALIDATION_FAILED: wear count cannot be negative'; end if;

  select * into it from items where id = p_item_id and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;

  select count(*) into logged
    from feedback where item_id = p_item_id and kind = 'worn';

  update items
     set wear_count        = p_count,
         initial_wear_count = greatest(p_count - logged, 0)
   where id = p_item_id
  returning * into it;

  return it;
end $$;

-- How much of an item's history was actually observed rather than estimated.
-- Insights that lean on wear data should say so when this is low.
create or replace function wear_confidence(it items) returns numeric
language sql immutable as $$
  select case when it.wear_count = 0 then 1::numeric
         else round((it.wear_count - it.initial_wear_count)::numeric
                    / it.wear_count, 2) end
$$;

commit;
