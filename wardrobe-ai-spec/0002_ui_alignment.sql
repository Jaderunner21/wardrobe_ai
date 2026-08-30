-- 0002_ui_alignment.sql
-- Reconciles the schema with the working prototype. See module 16 §7.
--
-- Four changes:
--   1. categories become a user-extensible TABLE; `slot` becomes an internal enum
--   2. occasions[] collapses to a single `style`
--   3. the Bin: soft delete via deleted_at, purged after 30 days
--   4. brand, plus the wardrobe_version counter module 05 §6 asks for

begin;

-- ═══════════════════════════════════════════ 1. slots vs categories

-- The recommendation engine assembles on fixed slots. Users browse by category.
-- These are different axes: Activewear contains both tops and bottoms, which is
-- why a single enum could not serve both.
create type slot_t as enum
  ('top', 'bottom', 'fullbody', 'outerwear', 'footwear', 'accessory');

create table categories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles on delete cascade,  -- NULL = system default
  name            text    not null,
  slug            text    not null,
  icon            text,                                        -- emoji, as the prototype uses
  default_slot    slot_t  not null,        -- suggested slot for items in this category
  subtypes        text[]  not null default '{}',
  outfit_eligible boolean not null default true,
  sort_order      smallint not null default 100,
  created_at      timestamptz not null default now()
);

-- one row per (owner, slug); system rows have user_id null
create unique index categories_system_slug_idx on categories (slug) where user_id is null;
create unique index categories_user_slug_idx   on categories (user_id, slug) where user_id is not null;
create index categories_user_idx on categories (user_id, sort_order);

-- The nine defaults, exactly as the prototype presents them.
-- Underwear and Sleepwear are browsable but never assembled into an outfit.
insert into categories (user_id, name, slug, icon, default_slot, subtypes, outfit_eligible, sort_order) values
 (null,'Tops',       'tops',       '👕','top',      '{t-shirt,blouse,tank top,sweater,shirt,hoodie}', true, 10),
 (null,'Bottoms',    'bottoms',    '👖','bottom',   '{jeans,pants,shorts,skirt,trousers}',            true, 20),
 (null,'Dresses',    'dresses',    '👗','fullbody', '{casual dress,formal dress,maxi dress,mini dress}', true, 30),
 (null,'Outerwear',  'outerwear',  '🧥','outerwear','{jacket,coat,cardigan,vest}',                    true, 40),
 (null,'Shoes',      'shoes',      '👟','footwear', '{sneakers,boots,heels,flats,sandals}',           true, 50),
 (null,'Accessories','accessories','👜','accessory','{bag,hat,scarf,jewelry,belt}',                   true, 60),
 (null,'Activewear', 'activewear', '🏃','top',      '{workout top,yoga pants,sports bra,athletic shorts}', true, 70),
 (null,'Sleepwear',  'sleepwear',  '😴','fullbody', '{pajamas,nightgown,robe}',                       false, 80),
 (null,'Underwear',  'underwear',  '👙','accessory','{bra,underwear,socks,tights}',                   false, 90);

alter table categories enable row level security;

-- everyone reads system categories; users read and write only their own
create policy categories_read on categories
  for select using (user_id is null or user_id = auth.uid());
create policy categories_write on categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══════════════════════════════════════════ 2. style

create type style_t as enum
  ('lounge', 'workout', 'casual', 'date-night', 'party', 'business', 'formal');

-- ═══════════════════════════════════════════ 3. items

alter table items
  add column category_id uuid references categories on delete set null,
  add column slot        slot_t,
  add column style       style_t,
  add column brand       text,
  add column deleted_at  timestamptz;

-- migrate the old enum column across, then drop it
update items set slot = case category::text
  when 'top' then 'top' when 'bottom' then 'bottom' when 'fullbody' then 'fullbody'
  when 'outerwear' then 'outerwear' when 'footwear' then 'footwear'
  else 'accessory' end::slot_t
 where category is not null;

update items i set category_id = c.id
  from categories c
 where c.user_id is null
   and c.default_slot = i.slot
   and i.category_id is null
   and c.slug in ('tops','bottoms','dresses','outerwear','shoes','accessories');

-- first element of the old array becomes the single style
update items set style = case occasions[1]
  when 'home'    then 'lounge'   when 'gym'    then 'workout'
  when 'college' then 'casual'   when 'travel' then 'casual'
  when 'work'    then 'business' when 'wedding' then 'formal'
  when 'casual'  then 'casual'   when 'formal' then 'formal'
  when 'party'   then 'party'    else 'casual' end::style_t
 where occasions is not null and array_length(occasions, 1) > 0;

alter table items drop column category;
alter table items drop column occasions;

-- outfit_items.slot was typed on the old enum; move it to slot_t before dropping
alter table outfit_items
  alter column slot type slot_t using slot::text::slot_t;

drop type item_category_t;

create index items_slot_idx     on items (user_id, slot)  where deleted_at is null and not archived;
create index items_category_idx on items (user_id, category_id) where deleted_at is null;
create index items_style_idx    on items (user_id, style) where deleted_at is null;
create index items_bin_idx      on items (deleted_at) where deleted_at is not null;

-- the old browse index no longer matches the query shape
drop index if exists items_user_browse_idx;
create index items_user_browse_idx
  on items (user_id, category_id, created_at desc)
  where deleted_at is null and not archived;

-- ═══════════════════════════════════════════ 4. quota excludes the bin

-- Binned items do NOT count toward the free cap; archived items DO.
-- Rationale: archiving is "I still own this", binning is "this is gone".
create or replace function enforce_item_quota() returns trigger
language plpgsql security definer as $$
declare
  cur_plan  plan_t;
  live_count int;
begin
  select plan into cur_plan from profiles where id = new.user_id for update;

  select count(*) into live_count
    from items where user_id = new.user_id and deleted_at is null;

  if cur_plan = 'free' and live_count >= 25 then
    raise exception 'ITEM_QUOTA_EXCEEDED' using errcode = 'check_violation';
  end if;

  update profiles
     set item_count      = live_count + 1,
         wardrobe_version = wardrobe_version + 1
   where id = new.user_id;
  return new;
end $$;

-- ═══════════════════════════════════════════ 5. wardrobe_version

alter table profiles add column wardrobe_version int not null default 0;

create or replace function bump_wardrobe_version() returns trigger
language plpgsql security definer as $$
declare uid uuid;
begin
  uid := coalesce(new.user_id, old.user_id);
  update profiles
     set wardrobe_version = wardrobe_version + 1,
         item_count = (select count(*) from items
                        where user_id = uid and deleted_at is null)
   where id = uid;
  return coalesce(new, old);
end $$;

create trigger items_version_upd after update on items
  for each row execute function bump_wardrobe_version();

-- replaces the old delete trigger, which only decremented the counter
drop trigger if exists items_quota_del on items;
create trigger items_version_del after delete on items
  for each row execute function bump_wardrobe_version();

-- ═══════════════════════════════════════════ 6. bin purge (PROD)

-- Purging must delete the stored images too, so it cannot be a bare SQL delete.
-- The worker route lists items past their 30 days, deletes the objects, then
-- deletes the rows. Uncomment at production; see module 15.
--
-- select cron.schedule('purge-bin', '0 5 * * *', $$
--   select net.http_post(
--     url     := current_setting('app.worker_url') || '/purge-bin',
--     headers := jsonb_build_object('Authorization', current_setting('app.worker_secret')))
-- $$);

-- ═══════════════════════════════════════════ 7. storage bucket

-- Private bucket. These are photographs of people's belongings; a public bucket
-- means anyone holding a URL can see one forever. Reads go through day-rounded
-- signed URLs (module 04 §6), which stay cacheable.
insert into storage.buckets (id, name, public)
values ('items', 'items', false)
on conflict (id) do nothing;

-- Path is items/{user_id}/{item_id}.webp, so foldername(name)[2] is the user id.
-- Verify that index against a real path before trusting it — an off-by-one here
-- grants everyone access to everything.
create policy "own items read" on storage.objects for select
  using (bucket_id = 'items' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "own items write" on storage.objects for insert
  with check (bucket_id = 'items' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "own items delete" on storage.objects for delete
  using (bucket_id = 'items' and (storage.foldername(name))[2] = auth.uid()::text);

commit;
