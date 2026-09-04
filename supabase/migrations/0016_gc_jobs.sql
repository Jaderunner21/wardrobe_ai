-- 0016_gc_jobs.sql
-- The last two scheduled jobs module 15 lists, and neither existed in a migration.
--
-- Both stay COMMENTED OUT with the rest (module 02 §4). At fifteen users there is
-- nothing to collect and an unexplained scheduled delete is worse than no scheduled
-- delete. They are written now so that item 4 of docs/test-to-production.md —
-- "uncomment the pg_cron jobs" — is a real instruction rather than a note to go and
-- write some SQL under production pressure.

begin;

-- ═══════════════════════════════════════════ gc-outfits

/*
 * Every "Generate" tap that the user did not save leaves an outfit row behind. At
 * fifteen users that is noise; at five thousand it is the second-fastest growing table
 * after `events`, and unlike events it is not even analytics.
 *
 * Saved outfits are kept forever — they are the user's. Planned ones are kept because a
 * plan for a past date is a wear history. Anything else, older than 30 days, with no
 * feedback attached, is a suggestion nobody acted on.
 */
create or replace function gc_outfits(p_days int default 30) returns int
language plpgsql security definer as $$
declare
  removed int;
begin
  delete from outfits o
   where o.created_at < now() - make_interval(days => p_days)
     and not o.saved
     and o.planned_for is null
     and not exists (select 1 from feedback f where f.outfit_id = o.id);

  get diagnostics removed = row_count;
  return removed;
end $$;

-- ═══════════════════════════════════════════ reconcile-storage

/*
 * Stored objects with no `items` row — module 15's weekly reconcile.
 *
 * Orphans are made by the paths module 04 §5 already documents: an upload that lands
 * before its row is created and then fails, and a permanent delete whose storage call
 * throws after the row is gone (that one is logged, deliberately, because an orphaned
 * object costs quota while an orphaned row renders a permanently broken card).
 *
 * REPORTS, NEVER DELETES. `storage.objects` is the only table in this database whose
 * rows ARE the files, and a bug in a where-clause here deletes photographs with no
 * undo. The job's job is to say what is unreferenced; deleting is a decision a person
 * makes after reading the list.
 */
create or replace function orphaned_objects()
returns table (name text, size bigint, created_at timestamptz)
language sql security definer as $$
  select o.name,
         (o.metadata->>'size')::bigint,
         o.created_at
    from storage.objects o
   where o.bucket_id = 'items'
     and not exists (
       select 1 from items i
        where i.storage_path = o.name or i.thumb_path = o.name
     )
     -- An object younger than a day may simply be mid-upload: module 04 creates the
     -- row after the bytes land, so there is always a window where both are true.
     and o.created_at < now() - interval '1 day'
   order by o.created_at;
$$;

-- TEST PHASE: commented out with every other scheduled job. Uncomment at production
-- alongside those in 0001_init.sql, 0002, 0003 and 0014 — see docs/test-to-production.md.
--
-- select cron.schedule('gc-outfits', '0 4 * * *', $$select gc_outfits(30)$$);
--
-- reconcile-storage has no cron line on purpose: it produces a list for a person to
-- read, not a change to apply. Run it from the SQL editor:
--     select * from orphaned_objects();

commit;
