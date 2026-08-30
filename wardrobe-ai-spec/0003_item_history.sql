-- 0003_item_history.sql
-- Two changes, both from the prototype's upload flow and the cost-per-wear feature:
--   1. `draft` status — the Review & Edit step before "Save All to Wardrobe"
--   2. purchase history + cost-per-wear columns (module 17)

begin;

-- ═══════════════════════════════════════════ 1. the review-before-save flow

-- The prototype's upload is: select → analyse → REVIEW & EDIT → Save All.
-- Nothing enters the wardrobe until the user confirms. `draft` is that state.
--
--   uploaded → tagging → draft → ready        (Save All flips draft → ready)
--                    ↘ failed → draft         (user fills it in by hand)
--
-- Drafts DO count toward the quota — their bytes are already uploaded. The presign
-- pre-check (module 04 §4) is what stops a user being surprised by that.
alter type item_status_t add value if not exists 'draft' after 'tagging';

commit;

begin;

-- ═══════════════════════════════════════════ 2. name and notes

-- The prototype names items ("Brown Leather Briefcase"); the spec only had `subtype`.
-- `name` is what the user reads, `subtype` is the structured kind. Both are needed.
alter table items
  add column name  text,
  add column notes text;

-- ═══════════════════════════════════════════ 3. purchase history

-- USER-ENTERED ONLY. The AI never populates these — a vision model cannot see
-- what something cost, and a plausible guess corrupts a financial record silently.
-- See module 17 §3.
alter table items
  add column price        numeric(12,2) check (price >= 0),
  add column currency     char(3),
  add column purchased_on date,
  add column retailer     text,
  add column cpw_target   numeric(10,2) check (cpw_target > 0);

alter table profiles
  add column currency   char(3)       not null default 'INR',
  add column cpw_target numeric(10,2) not null default 100 check (cpw_target > 0);

-- Cost per wear, maintained by Postgres so it can be sorted and filtered on.
-- max(wear_count, 1) — an unworn item's CPW is its full price, not a divide by zero.
alter table items
  add column cost_per_wear numeric(12,2)
  generated always as (price / greatest(wear_count, 1)) stored;

create index items_cpw_idx on items (user_id, cost_per_wear)
  where price is not null and deleted_at is null;

create index items_unworn_idx on items (user_id, last_worn_on)
  where deleted_at is null and not archived;

-- draft items are excluded from every wardrobe view
create index items_draft_idx on items (user_id, created_at)
  where status = 'draft';

commit;

-- ═══════════════════════════════════════════ 4. abandoned drafts (PROD)

-- A user who closes the tab mid-review leaves drafts holding quota and stored images
-- forever. Bin them after 24 hours; the bin purge (0002 §6) then deletes the images.
--
-- select cron.schedule('bin-stale-drafts', '15 * * * *', $$
--   update items set deleted_at = now()
--    where status = 'draft' and created_at < now() - interval '24 hours'
--      and deleted_at is null
-- $$);
