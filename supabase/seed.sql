-- Test-phase seeding (module 03 §7).
--
-- The 15 testers are seeded `premium` so nobody meets the 25-item wall during the
-- test — you want feedback on the product, not on the paywall. The quota trigger
-- stays installed and covered by a test so the code path stays exercised.
--
-- Replace the address list before running. Applied by `supabase db reset` locally;
-- run by hand against the hosted project.

update profiles set plan = 'premium'
 where id in (
   select id from auth.users
    where email = any (array[
      -- 'tester1@example.com',
      -- 'tester2@example.com'
    ]::text[])
 );
