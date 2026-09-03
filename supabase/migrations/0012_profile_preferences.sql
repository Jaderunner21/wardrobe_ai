-- 0012_profile_preferences.sql
-- Display preferences — module 16 §4's Appearance tab.
--
-- The tab promises three controls: dark mode, date format and default sort. Dark mode
-- is a token swap and lives in the browser, where it belongs — the theme has to apply
-- before the first paint. The other two do not:
--
--   * default sort decides how the wardrobe query is ORDERED, and that query runs on the
--     server before any client JavaScript exists. Kept in localStorage it would render
--     one order, then re-render into another.
--   * date format is read by both server and client components, and a preference that
--     disagrees between the two is worse than no preference.
--
-- One jsonb column rather than two typed ones: these are display preferences with no
-- constraints worth enforcing in Postgres and no queries that filter on them, and the
-- next one will not need a migration. `onboarding` is left alone — it tracks a
-- different thing and mixing them would make both harder to reason about.

begin;

alter table profiles
  add column preferences jsonb not null default '{}'::jsonb;

commit;
