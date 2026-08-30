-- 0006_auth_profile_trigger.sql
-- Profile creation on first sign-in (module 03 §2).
--
-- This is a Postgres trigger on auth.users, not application code. Application-side
-- creation races the first authenticated request and produces intermittent
-- "profile not found" errors that are miserable to reproduce.
--
-- It seeds style_profiles too, so module 10 never has to handle a missing row.

begin;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  insert into public.style_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

commit;
