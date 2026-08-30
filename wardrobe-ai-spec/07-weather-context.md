# 07 — Weather context

**Scope:** TEST · **Depends on:** 02 · **Owns:** `weather_cache`, `lib/weather.ts`,
`app/api/weather/route.ts`

## Responsibility

Provide today's temperature and conditions for the user's city, cached aggressively enough
that 5,000 users cost ~200 upstream calls a day.

## Contracts

```ts
// lib/weather.ts
export function getWeather(cityKey: string, day: string): Promise<WeatherContext | null>;
export function tempBucket(tempC: number): TempBucket;
```

`GET /api/weather` → `{ weather: WeatherContext | null }`.

## Behaviour

### 1. Cache per city per day, never per user

The cache key is `(city_key, day)`, not `(user_id, day)`. Fifteen testers in Udaipur are one
upstream call. Five thousand users across ~200 cities are ~200 calls a day — which is why
this feature is free at any scale in scope.

`city_key` is `lower(city) + ',' + lower(country)`, e.g. `udaipur,in`.

### 2. Temperature buckets

Recommendations are cached per bucket, not per degree. Two degrees of difference does not
change what you should wear; caching per degree would make the cache useless.

```ts
export function tempBucket(t: number): TempBucket {
  if (t < 10) return 0;
  if (t < 18) return 1;
  if (t < 24) return 2;
  if (t < 30) return 3;
  return 4;
}
```

`TARGET_WARMTH_SUM` in `types.ts` maps each bucket to the total garment warmth the
recommendation engine aims for: `{0:11, 1:9, 2:7, 3:5, 4:3}`.

### 3. Provider

| Phase | Provider | Note |
|---|---|---|
| Test | **Open-Meteo** | free, no API key, no signup |
| Production | **OpenWeatherMap free tier** or Open-Meteo paid | see below |

Open-Meteo's free tier prohibits commercial use. During the test phase nothing is
commercial, so it is fine. The moment there is a paid plan, it isn't.

Because every call goes through `lib/weather.ts` and lands in `weather_cache`, that swap is
one file with no schema change and no call-site changes. Write the provider behind a small
interface so this stays true:

```ts
interface WeatherProvider {
  fetch(city: string, country: string): Promise<Omit<WeatherContext, 'cityKey' | 'day' | 'tempBucket'>>;
}
```

### 4. Missing city degrades, never guesses

No `profile.city` → return `null`. The recommendation engine then skips the thermal term and
renormalises the remaining weights (module 08).

Do not IP-geolocate. It is wrong often enough to produce baffling recommendations, and a
user who did not give you their location did not give it to you.

### 5. Upstream failure degrades too

Provider down or slow → return the most recent cached row for that city if it is within
2 days; otherwise `null`. Never let a weather outage break outfit recommendations. Timeout
at 3 seconds.

### 6. Which temperature

Use the daytime representative temperature — roughly the 14:00 local forecast, or the
midpoint of min and max if hourly data isn't handy. Store min and max as well so the UI can
say "18–29°, layer up for the evening", which is more useful than a single number.

### 7. Cleanup

Rows older than 2 days are dead. `pg_cron` prunes them daily in production. Test phase: the
table is a handful of rows; skip it.

## Acceptance

- [ ] two users in the same city on the same day cause exactly one upstream call
- [ ] `tempBucket` boundaries match the table above exactly, including at 10, 18, 24, 30
- [ ] a user with no city gets `null` and recommendations still work
- [ ] a 500 from the provider with a 1-day-old cache row returns the cached row
- [ ] a 500 with no cache row returns `null`, not an error
- [ ] provider is swappable without touching any call site

## Out of scope

- Hourly forecasts, multi-day planning. The outfit calendar (09) plans dates; it does not
  forecast them.
- Rain-specific recommendations beyond the `precipitationMm` field being available.
- Air quality, UV.
