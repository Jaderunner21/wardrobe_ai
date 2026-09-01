-- 0008_ai_tagging.sql
-- The two columns module 06 needs on `items`.
--
-- `ai_raw` is referenced by module 02 §3 ("items carries an ai_raw JSONB column
-- holding the full model response") and required by module 06 §6, but it is not in
-- schema.sql. Same for the failure message module 06 §4 stores on a failed tag. This
-- migration adds both.
--
-- WHY ai_raw IS WORTH THE BYTES
--
-- When the prompt changes or the model is swapped, the stored responses let you
-- re-derive attributes without paying for the vision call again, and diff old against
-- new to see what actually moved. It is deliberately excluded from ITEM_LIST_COLUMNS:
-- no grid needs it, and selecting it on the wardrobe view is what takes egress from
-- 1.29 GB/month to 4.29 GB at production scale.

begin;

alter table items
  add column ai_raw   jsonb,
  -- Why the last tag attempt failed. Shown next to the Retry button, not to be
  -- confused with ai_jobs.last_error, which belongs to the production retry lane.
  add column ai_error text;

commit;
