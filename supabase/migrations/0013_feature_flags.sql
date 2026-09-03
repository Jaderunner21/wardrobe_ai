-- 0013_feature_flags.sql
-- Per-user feature flags — module 19 §7.
--
-- §7 is not a suggestion about rollout hygiene, it is the module's own condition for
-- existing: "Ship it behind a per-user flag and compare, for at least two weeks... If the
-- AI engine does not beat the rules engine on that number, keep the rules engine and say
-- so." The module is built on an argument, not on evidence, and the flag is what turns
-- one into the other.
--
-- A flag with no way to move it is a constant with extra steps, so the admin console
-- writes this column and `lib/flags.ts` reads it. Absent means "not assigned" and the
-- app buckets deterministically from the user id — a stable 50/50 split that needs no
-- write, so a comparison starts the moment this ships rather than when someone
-- remembers to flip switches.

begin;

alter table profiles
  add column flags jsonb not null default '{}'::jsonb;

commit;
