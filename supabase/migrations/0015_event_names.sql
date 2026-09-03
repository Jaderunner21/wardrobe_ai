-- 0015_event_names.sql
-- Bring existing analytics rows onto module 14's event vocabulary.
--
-- The codebase has emitted dotted names — `item.created`, `item.corrected` — since
-- module 05, because analytics arrived before the module that owns them. Module 14's
-- contract uses snake_case, and its §1 queries are written against those literal
-- strings: `where name = 'item_corrected'`. Two vocabularies would mean the correction
-- rate silently reads half the data, which is worse than reading none.
--
-- Renaming the rows rather than teaching the queries both spellings, because the rows
-- are the smaller thing: 38 of them, all from the developer's own test wardrobe, and
-- the alternative is every future query carrying an `in (...)` for a naming decision
-- nobody will remember.

begin;

update events set name = 'item_uploaded'  where name = 'item.created';
update events set name = 'item_corrected' where name = 'item.corrected';
update events set name = 'item_deleted'   where name = 'item.deleted';
update events set name = 'item_restored'  where name = 'item.restored';
update events set name = 'item_archived'  where name = 'item.archived';
update events set name = 'item_saved'     where name = 'item.saved';
update events set name = 'item_discarded' where name = 'item.discarded';
update events set name = 'quota_hit'      where name = 'quota.blocked';

commit;
