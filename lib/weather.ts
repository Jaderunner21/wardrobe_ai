/**
 * Weather context — module 07. Server only.
 *
 * Cached per city per day, never per user: fifteen testers in Udaipur are one upstream
 * call, and five thousand users across ~200 cities are ~200 calls a day. That is why
 * this feature is free at every scale in scope.
 *
 * Every call goes through this file and lands in `weather_cache`, so replacing
 * Open-Meteo at production (its free tier prohibits commercial use — module 07 §3) is
 * one implementation of `WeatherProvider` and no call-site changes.
 */
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { toWeatherContext, type WeatherCacheRow } from '@/lib/mappers';
import type { TempBucket, WeatherContext } from '@/types';

/** Everything a provider must return. Buckets and keys are computed here, not there. */
export interface WeatherProvider {
  fetch(city: string, country: string): Promise<ProviderResult | null>;
}

export type ProviderResult = Omit<WeatherContext, 'cityKey' | 'day' | 'tempBucket'>;

/** `udaipur,in` — lowercased, so "Udaipur" and "udaipur " are one cache entry. */
export const cityKeyFor = (city: string, country: string): string =>
  `${city.trim().toLowerCase()},${country.trim().toLowerCase()}`;

/**
 * Recommendations are cached per bucket, not per degree (module 07 §2). Two degrees
 * does not change what you should wear, and caching per degree makes the cache
 * useless.
 */
export function tempBucket(t: number): TempBucket {
  if (t < 10) return 0;
  if (t < 18) return 1;
  if (t < 24) return 2;
  if (t < 30) return 3;
  return 4;
}

/** A stale row still beats no weather at all, up to this age (module 07 §5). */
const STALE_DAYS = 2;
const PROVIDER_TIMEOUT_MS = 3000;

/**
 * Today's weather for a city, or null. Never throws: a weather outage must not break
 * outfit recommendations, it must make them weather-blind.
 */
export async function getWeather(
  cityKey: string,
  day: string,
  provider: WeatherProvider = openMeteo,
): Promise<WeatherContext | null> {
  const supabase = await createClient();

  const { data: cached } = await supabase
    .from('weather_cache')
    .select('city_key, day, payload, fetched_at')
    .eq('city_key', cityKey)
    .eq('day', day)
    .maybeSingle();

  if (cached) return toWeatherContext(cached as unknown as WeatherCacheRow);

  const [city, country] = cityKey.split(',');
  if (!city || !country) return null;

  try {
    const fresh = await provider.fetch(city, country);
    if (!fresh) return await mostRecent(cityKey, day);

    const payload = { ...fresh, tempBucket: tempBucket(fresh.tempC) };

    // Writing through a security-definer function; see 0009_weather_cache_write.sql
    // for why this is not the service-role client.
    await supabase.rpc('cache_weather', {
      p_city_key: cityKey,
      p_day: day,
      p_payload: payload,
    });

    return { cityKey, day, ...payload };
  } catch (e) {
    console.error('[weather] provider failed', { cityKey, e });
    return await mostRecent(cityKey, day);
  }
}

/** The most recent row for this city, if it is recent enough to still mean something. */
async function mostRecent(cityKey: string, day: string): Promise<WeatherContext | null> {
  const supabase = await createClient();
  const floor = new Date(`${day}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - STALE_DAYS);

  const { data } = await supabase
    .from('weather_cache')
    .select('city_key, day, payload, fetched_at')
    .eq('city_key', cityKey)
    .gte('day', floor.toISOString().slice(0, 10))
    .order('day', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? toWeatherContext(data as unknown as WeatherCacheRow) : null;
}

// ───────────────────────────────────────────────────────────── Open-Meteo

/**
 * WMO weather codes → display text. Free text, display only; nothing branches on it.
 * https://open-meteo.com/en/docs — the table is stable and small enough to inline.
 */
export function describeWmo(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

/**
 * The daytime representative temperature — module 07 §6. The 14:00 local reading if
 * hourly data came back, otherwise the midpoint of min and max. Min and max are stored
 * too, so the UI can say "18–29°, layer up for the evening".
 */
export function representativeTemp(
  hourly: { time: string[]; temperature_2m: number[] } | undefined,
  min: number,
  max: number,
): number {
  const index = hourly?.time?.findIndex((t) => t.endsWith('T14:00')) ?? -1;
  const at14 = index >= 0 ? hourly?.temperature_2m?.[index] : undefined;
  return typeof at14 === 'number' ? at14 : Math.round(((min + max) / 2) * 10) / 10;
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export const openMeteo: WeatherProvider = {
  async fetch(city, country) {
    const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);

    // Open-Meteo forecasts by coordinate, so the city name is resolved first.
    const geo = await fetch(
      `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json&country_code=${encodeURIComponent(country.toUpperCase())}`,
      { signal },
    );
    if (!geo.ok) throw new Error(`geocode ${geo.status}`);

    const place = (await geo.json()) as {
      results?: { latitude: number; longitude: number }[];
    };
    const first = place.results?.[0];
    // An unrecognised city is not an outage — it degrades to no weather, like a user
    // who never set one (module 07 §4).
    if (!first) return null;

    const forecast = await fetch(
      `${FORECAST_URL}?latitude=${first.latitude}&longitude=${first.longitude}` +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code' +
        '&hourly=temperature_2m&timezone=auto&forecast_days=1',
      { signal },
    );
    if (!forecast.ok) throw new Error(`forecast ${forecast.status}`);

    return parseOpenMeteo(await forecast.json());
  },
};

/** Split out so it can be tested against a recorded response, with no network. */
export function parseOpenMeteo(payload: unknown): ProviderResult | null {
  const body = payload as {
    daily?: {
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_sum?: number[];
      weather_code?: number[];
    };
    hourly?: { time: string[]; temperature_2m: number[] };
  };

  const max = body.daily?.temperature_2m_max?.[0];
  const min = body.daily?.temperature_2m_min?.[0];
  if (typeof max !== 'number' || typeof min !== 'number') return null;

  return {
    tempC: representativeTemp(body.hourly, min, max),
    tempMinC: min,
    tempMaxC: max,
    precipitationMm: body.daily?.precipitation_sum?.[0] ?? 0,
    condition: describeWmo(body.daily?.weather_code?.[0] ?? 0),
  };
}
