-- Wardrobe AI — production schema (Supabase / Postgres 15+)
-- Auth is provided by Supabase (auth.users). Everything below is app-owned.
-- Every table is RLS-protected: a user can only ever touch their own rows.

create extension if not exists "pgcrypto";

-- pg_cron and pg_net exist on Supabase but not on a stock Postgres image, and CI
-- applies these migrations to a stock one (module 15 CI step 8). They are only
-- needed by the scheduled jobs at the bottom of this file, which are commented out
-- for the test phase, so a missing extension must not fail the migration.
do $ext$
begin
  create extension if not exists "pg_cron";
exception when others then
  raise notice 'pg_cron unavailable here; the scheduled jobs are commented out anyway';
end
$ext$;

do $ext$
begin
  create extension if not exists "pg_net";
exception when others then
  raise notice 'pg_net unavailable here; the ai_jobs drain is commented out anyway';
end
$ext$;

-- ============================================================ enums

create type plan_t          as enum ('free', 'premium');
create type item_status_t   as enum ('uploaded', 'tagging', 'ready', 'failed');
create type item_category_t as enum ('top', 'bottom', 'fullbody', 'outerwear', 'footwear', 'accessory');
create type job_status_t    as enum ('queued', 'running', 'done', 'dead');
create type feedback_t      as enum ('up', 'down', 'worn', 'skipped');
create type source_t        as enum ('rules', 'llm', 'manual');

-- ============================================================ identity

create table profiles (
  id                uuid primary key references auth.users on delete cascade,
  display_name      text,
  avatar_key        text,
  city              text,
  country           text        not null default 'IN',
  timezone          text        not null default 'Asia/Kolkata',
  plan              plan_t      not null default 'free',
  plan_renews_at    timestamptz,
  razorpay_sub_id   text unique,
  item_count        int         not null default 0,   -- maintained by trigger
  onboarding        jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- Learned preference state. Small, rewritten in place — never grows unbounded.
create table style_profiles (
  user_id            uuid primary key references profiles on delete cascade,
  color_affinity     jsonb  not null default '{}'::jsonb,  -- {"navy":0.8,"mustard":-0.4}
  category_affinity  jsonb  not null default '{}'::jsonb,
  formality_bias     real   not null default 0,            -- -1 casual .. +1 formal
  novelty_bias       real   not null default 0.5,
  rejected_pairs     jsonb  not null default '[]'::jsonb,  -- [["navy","black"], ...]
  sample_count       int    not null default 0,
  updated_at         timestamptz not null default now()
);

-- ============================================================ wardrobe

create table items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles on delete cascade,
  status           item_status_t not null default 'uploaded',

  -- object storage (Supabase Storage) — the DB never stores image bytes.
  -- Provider-neutral names: swapping to R2 later is a config change, not a migration.
  storage_path     text not null,          -- items/{user_id}/{item_id}.webp
  thumb_path       text not null,          -- items/{user_id}/{item_id}_t.webp
  bytes            int,
  width            int,
  height           int,
  content_hash     text,                       -- sha256 of normalised bytes, dedupe

  -- AI-extracted, user-correctable
  category         item_category_t,
  subtype          text,                       -- 'oxford shirt', 'chinos'
  primary_color    text,
  color_hex        char(7),
  secondary_colors text[]    not null default '{}',
  pattern          text,                       -- solid | striped | checked | printed
  material         text,
  formality        smallint  check (formality  between 1 and 5),
  warmth           smallint  check (warmth     between 1 and 5),
  seasons          text[]    not null default '{}',
  occasions        text[]    not null default '{}',
  ai_confidence    real,
  ai_model         text,
  user_edited      boolean   not null default false,

  -- user state
  user_tags        text[]    not null default '{}',
  favourite        boolean   not null default false,
  wear_count       int       not null default 0,
  last_worn_on     date,
  archived         boolean   not null default false,
  created_at       timestamptz not null default now()
);

create index items_user_browse_idx on items (user_id, archived, category, created_at desc);
create index items_user_status_idx on items (user_id, status) where status <> 'ready';
create index items_seasons_idx     on items using gin (seasons);
create index items_tags_idx        on items using gin (user_tags);
create unique index items_dedupe_idx on items (user_id, content_hash) where content_hash is not null;

-- ============================================================ outfits

create table outfits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles on delete cascade,
  source        source_t not null default 'rules',
  occasion      text,
  season        text,
  temp_bucket   smallint,                      -- weather bucket the rec was built for
  score         real,
  rationale     text,                          -- short "why this works" copy
  saved         boolean not null default false,
  planned_for   date,                          -- outfit calendar
  created_at    timestamptz not null default now()
);

create index outfits_user_idx      on outfits (user_id, created_at desc);
create index outfits_calendar_idx  on outfits (user_id, planned_for) where planned_for is not null;

create table outfit_items (
  outfit_id uuid not null references outfits on delete cascade,
  item_id   uuid not null references items   on delete cascade,
  slot      item_category_t not null,
  primary key (outfit_id, item_id)
);

create index outfit_items_item_idx on outfit_items (item_id);

create table feedback (
  id         bigserial primary key,
  user_id    uuid not null references profiles on delete cascade,
  outfit_id  uuid references outfits on delete cascade,
  item_id    uuid references items   on delete cascade,
  kind       feedback_t not null,
  created_at timestamptz not null default now()
);

create index feedback_user_idx on feedback (user_id, created_at desc);

-- ============================================================ cost control

-- One row per (user, occasion, temp bucket, day). Serves repeat requests for free.
create table recommendation_cache (
  user_id     uuid not null references profiles on delete cascade,
  cache_key   text not null,                   -- md5(occasion|temp|wardrobe_version)
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  primary key (user_id, cache_key)
);

create index reccache_gc_idx on recommendation_cache (expires_at);

-- Weather is cached per city per day, not per user. ~200 rows/day for 5k users.
create table weather_cache (
  city_key    text not null,                   -- lowercased "udaipur,in"
  day         date not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (city_key, day)
);

-- Hard ceiling on AI spend, enforced before every model call.
create table ai_usage (
  user_id     uuid not null references profiles on delete cascade,
  day         date not null,
  tag_calls   int not null default 0,
  chat_calls  int not null default 0,
  llm_calls   int not null default 0,
  in_tokens   bigint not null default 0,
  out_tokens  bigint not null default 0,
  primary key (user_id, day)
);

-- Retry lane. The happy path tags inline; only failures land here.
create table ai_jobs (
  id          bigserial primary key,
  user_id     uuid not null references profiles on delete cascade,
  item_id     uuid references items on delete cascade,
  kind        text not null,                   -- 'tag'
  status      job_status_t not null default 'queued',
  attempts    smallint not null default 0,
  last_error  text,
  run_after   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index ai_jobs_claim_idx on ai_jobs (status, run_after) where status = 'queued';

-- Product analytics. 30-day retention, pruned by cron — this is what keeps
-- the 500 MB free-tier database from filling up.
create table events (
  id         bigserial primary key,
  user_id    uuid references profiles on delete set null,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_time_idx on events (created_at);

-- ============================================================ invariants

-- Free plan gets 25 items. This is the storage guardrail AND the paywall.
create or replace function enforce_item_quota() returns trigger
language plpgsql security definer as $$
declare
  cur_plan plan_t;
  cur_count int;
begin
  select plan, item_count into cur_plan, cur_count
    from profiles where id = new.user_id for update;

  if cur_plan = 'free' and cur_count >= 25 then
    raise exception 'ITEM_QUOTA_EXCEEDED' using errcode = 'check_violation';
  end if;

  update profiles set item_count = item_count + 1 where id = new.user_id;
  return new;
end $$;

create trigger items_quota_ins before insert on items
  for each row execute function enforce_item_quota();

create or replace function decrement_item_count() returns trigger
language plpgsql security definer as $$
begin
  update profiles set item_count = greatest(item_count - 1, 0) where id = old.user_id;
  return old;
end $$;

create trigger items_quota_del after delete on items
  for each row execute function decrement_item_count();

-- ============================================================ RLS

alter table profiles             enable row level security;
alter table style_profiles       enable row level security;
alter table items                enable row level security;
alter table outfits              enable row level security;
alter table outfit_items         enable row level security;
alter table feedback             enable row level security;
alter table recommendation_cache enable row level security;
alter table ai_usage             enable row level security;
alter table ai_jobs              enable row level security;
alter table events               enable row level security;

create policy own_profile on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy own_style on style_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_items on items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_outfits on outfits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_outfit_items on outfit_items
  for all using (exists (
    select 1 from outfits o where o.id = outfit_id and o.user_id = auth.uid()));

create policy own_feedback on feedback
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_reccache on recommendation_cache
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_usage_read on ai_usage
  for select using (user_id = auth.uid());

create policy own_jobs_read on ai_jobs
  for select using (user_id = auth.uid());

create policy own_events_insert on events
  for insert with check (user_id = auth.uid());

-- weather_cache is global, read-only to clients
alter table weather_cache enable row level security;
create policy weather_read on weather_cache for select using (true);

-- ============================================================ maintenance

-- TEST PHASE: the scheduled jobs below are deliberately commented out.
-- There is nothing to collect at 15 users, and an unexplained scheduled delete is
-- worse than no scheduled delete (module 02 §4). Uncomment at production as part of
-- the test → production checklist — see module 15 and docs/test-to-production.md.
--
-- select cron.schedule('gc-reccache', '*/15 * * * *',
--   $$delete from recommendation_cache where expires_at < now()$$);
--
-- select cron.schedule('gc-events', '30 3 * * *',
--   $$delete from events where created_at < now() - interval '30 days'$$);
--
-- select cron.schedule('gc-weather', '0 4 * * *',
--   $$delete from weather_cache where day < current_date - 2$$);
--
-- -- drains the retry lane every 5 minutes
-- select cron.schedule('drain-ai-jobs', '*/5 * * * *', $$
--   select net.http_post(
--     url     := current_setting('app.worker_url'),
--     headers := jsonb_build_object('Authorization', current_setting('app.worker_secret'))
--   ) where exists (select 1 from ai_jobs where status = 'queued' and run_after < now())
-- $$);
