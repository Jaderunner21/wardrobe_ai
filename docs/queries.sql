-- Module 14 §1 — the queries that decide the test phase.
--
-- There is no dashboard, deliberately (§6): fifteen users produce numbers you read with
-- four queries, and time spent building charts is time not spent talking to the testers,
-- which is the actual research method at this size. Run these weekly, paste the answers
-- into a text file, and build a dashboard only when reading them becomes the bottleneck.
--
-- Run in the Supabase SQL editor, or:
--   pnpm supabase db query --linked -f docs/queries.sql

-- ═══════════════════════════════════════════ 1. Correction rate
--
-- Is tagging actually working? Target: under 25%.
--
-- Expect `material` and `formality` to dominate — they are genuinely hard from one photo
-- of a garment lying on a bed. If `categoryId` or `primaryColor` are high, the PROMPT is
-- broken, not the task, and module 06 §2's anchored examples are where to look.

select props->>'field' as field,
       count(*)        as corrections
  from events
 where name = 'item_corrected'
 group by 1
 order by 2 desc;

-- The rate itself. 13 is AI_FIELD_COUNT in lib/events.ts — every field the tagger fills.
-- Keep the two in step; a denominator that drifts is how a metric quietly flatters you.

select
  (select count(*) from events where name = 'item_corrected')::numeric
  / nullif((select count(*) from events where name = 'item_tagged') * 13, 0)
  as correction_rate;

-- ═══════════════════════════════════════════ 2. Onboarding completion
--
-- Does anyone get past the tedious part? Target: more than 10 of 15 reach a tenth item.

select user_id,
       min(created_at) filter (where name = 'signup')        as signed_up,
       min(created_at) filter (where name = 'item_uploaded') as first_item,
       (select created_at
          from events e2
         where e2.user_id = e.user_id
           and e2.name = 'item_uploaded'
         order by created_at
         offset 9 limit 1)                                   as tenth_item
  from events e
 group by user_id
 order by signed_up;

-- ═══════════════════════════════════════════ 3. Day-7 return
--
-- Does anyone come back? Target: more than 5 of 15.

select count(distinct user_id) as returned_on_day_7
  from events e
 where created_at::date = (
   select min(created_at)::date + 7
     from events e2
    where e2.user_id = e.user_id
 );

-- ═══════════════════════════════════════════ 4. Recommendation quality
--
-- Thumbs-up rate. Target: above 60%.

select count(*) filter (where props->>'kind' = 'up')::numeric
       / nullif(count(*) filter (where props->>'kind' in ('up', 'down')), 0)
       as thumbs_up_rate
  from events
 where name = 'feedback_given'
   and props->>'subject' = 'outfit';

-- ═══════════════════════════════════════════ 5. Module 19 §7 — which engine won
--
-- "Ship it behind a per-user flag and compare, for at least two weeks: thumbs-up rate,
-- saved-outfit rate, how often a suggestion is actually worn. Those three numbers decide
-- whether the model earned the swap. Run the comparison rather than assuming."
--
-- If the AI arm does not beat the rules arm, keep the rules engine and say so.

with shown as (
  select props->>'source' as source, count(*) as viewed
    from events where name = 'recommendations_viewed'
   group by 1
),
rated as (
  select props->>'source' as source,
         count(*) filter (where props->>'kind' = 'up')   as ups,
         count(*) filter (where props->>'kind' = 'down') as downs
    from events
   where name = 'feedback_given' and props->>'subject' = 'outfit'
   group by 1
),
kept as (
  select props->>'source' as source, count(*) as saves
    from events where name = 'outfit_saved' group by 1
),
worn as (
  select props->>'source' as source, count(*) as wears
    from events where name = 'outfit_worn' group by 1
)
select coalesce(shown.source, rated.source, kept.source, worn.source) as engine,
       shown.viewed,
       rated.ups,
       rated.downs,
       round(rated.ups::numeric / nullif(rated.ups + rated.downs, 0), 2) as thumbs_up_rate,
       kept.saves,
       worn.wears
  from shown
  full join rated using (source)
  full join kept  using (source)
  full join worn  using (source)
 order by engine;

-- How the two arms are populated, so a lopsided comparison is visible rather than
-- mistaken for a result.

select flags->>'aiRecommendations' as assignment, count(*)
  from profiles group by 1;

-- ═══════════════════════════════════════════ 6. Housekeeping
--
-- What the events table is costing. §3: this is the only unbounded table that is not
-- user-value data, and the 30-day retention job is what keeps the capacity numbers real.

select name, count(*) as rows, min(created_at) as oldest
  from events group by 1 order by 2 desc;

select pg_size_pretty(pg_total_relation_size('events')) as events_size;
