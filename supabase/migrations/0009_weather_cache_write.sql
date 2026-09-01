-- 0009_weather_cache_write.sql
-- Lets the server fill `weather_cache` (module 07 §1).
--
-- `weather_cache` is the one table that is global rather than per-user, and 0001 gives
-- it a SELECT policy only. Reads work for everyone; nothing can write. The forecast is
-- fetched by a route handler running as the signed-in user, so without this the cache
-- could never be populated.
--
-- WHY A FUNCTION RATHER THAN THE SERVICE ROLE
--
-- Module 03 is explicit that the service-role client belongs in exactly three files.
-- Filling a shared cache is not one of them, and reaching for that key here would make
-- the rule meaningless. So: a security-definer function, narrow enough to be safe in
-- the hands of any authenticated caller.
--
-- Two things keep it safe. It never overwrites an existing row, so a hostile caller
-- would have to beat the real fetch to a city-day that nobody has looked up yet; and
-- the payload is range-checked, so the damage available is a plausible-but-wrong
-- forecast in one city for one day. Rows are dead after two days regardless.

begin;

create or replace function cache_weather(
  p_city_key text,
  p_day      date,
  p_payload  jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t numeric := (p_payload->>'tempC')::numeric;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_city_key is null or length(p_city_key) > 120 then
    raise exception 'VALIDATION_FAILED: bad city key';
  end if;

  -- A forecast outside this range is not a forecast.
  if t is null or t < -60 or t > 60 then
    raise exception 'VALIDATION_FAILED: implausible temperature';
  end if;

  if p_day < current_date - 2 or p_day > current_date + 2 then
    raise exception 'VALIDATION_FAILED: day out of range';
  end if;

  insert into weather_cache (city_key, day, payload)
  values (p_city_key, p_day, p_payload)
  on conflict (city_key, day) do nothing;
end $$;

revoke all on function cache_weather(text, date, jsonb) from public;
grant execute on function cache_weather(text, date, jsonb) to authenticated;

commit;
