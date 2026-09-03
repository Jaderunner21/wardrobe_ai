'use client';

/**
 * "Today's Weather Outfit" — module 16 §4.
 *
 * The weather select is a manual override, defaulted to the real forecast (module 07).
 * A person who knows it will be colder than the forecast should be able to say so —
 * the prototype had only the dropdown and no forecast behind it; this has both.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ItemImage } from '@/components/ItemImage';
import { matchPercent, type Recommendation, type Style, type WeatherContext } from '@/types';

interface Response {
  recommendations: Recommendation[];
  weather: WeatherContext | null;
  reason: string | null;
  imageUrls: Record<string, string>;
}

/** Labels for the five temperature buckets, in the terms a person would use. */
const CONDITIONS: { bucket: number; label: string }[] = [
  { bucket: 0, label: 'Cold (under 10°)' },
  { bucket: 1, label: 'Cool (10–18°)' },
  { bucket: 2, label: 'Mild (18–24°)' },
  { bucket: 3, label: 'Warm (24–30°)' },
  { bucket: 4, label: 'Hot (30°+)' },
];

export function TodaysOutfit({ style = 'casual' }: { style?: Style }) {
  const [override, setOverride] = useState<number | null>(null);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (bucket: number | null, refresh = false) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ style, limit: '1' });
        if (bucket !== null) params.set('tempBucket', String(bucket));
        if (refresh) params.set('refresh', 'true');

        const response = await fetch(`/api/recommendations?${params.toString()}`);
        if (!response.ok) throw new Error('failed');
        setData((await response.json()) as Response);
      } catch {
        setError('Could not build today’s outfit.');
      } finally {
        setLoading(false);
      }
    },
    [style],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const outfit = data?.recommendations[0];

  return (
    <section className="rounded-[var(--radius-lg)] bg-brand-50 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-section font-semibold tracking-tight">Today’s Weather Outfit</h2>

        <div className="flex items-center gap-2">
          <label htmlFor="weather-override" className="sr-only">
            Weather
          </label>
          <select
            id="weather-override"
            value={override ?? data?.weather?.tempBucket ?? 2}
            onChange={(e) => {
              const bucket = Number(e.target.value);
              setOverride(bucket);
              void load(bucket);
            }}
            className="rounded-[var(--radius)] border border-brand-300 bg-surface px-3 py-1.5 text-meta text-text"
          >
            {CONDITIONS.map((c) => (
              <option key={c.bucket} value={c.bucket}>
                {c.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => load(override, true)}
            disabled={loading}
            aria-label="Refresh today’s outfit"
            className="rounded-[var(--radius)] border border-brand-300 bg-surface px-3 py-1.5 text-meta font-medium hover:bg-brand-100 disabled:opacity-60"
          >
            ⟳
          </button>
        </div>
      </div>

      {data?.weather && override === null && (
        <p className="mb-3 text-meta text-text-dim">
          {Math.round(data.weather.tempMinC)}–{Math.round(data.weather.tempMaxC)}° ·{' '}
          {data.weather.condition}
          {data.weather.tempMaxC - data.weather.tempMinC >= 8 && ' — layer up for the evening'}
        </p>
      )}

      {loading && <div className="h-24 animate-pulse rounded-[var(--radius)] bg-brand-100" />}

      {!loading && error && (
        <p role="alert" className="text-meta text-danger-600">
          {error}{' '}
          <button type="button" onClick={() => load(override)} className="underline underline-offset-4">
            Try again
          </button>
        </p>
      )}

      {!loading && !error && !outfit && (
        <p className="text-body text-text-dim">
          {data?.reason ?? 'Add a few more items to get outfit suggestions.'}{' '}
          <Link href="/upload" className="text-brand-700 underline underline-offset-4">
            Add items
          </Link>
        </p>
      )}

      {!loading && outfit && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-card font-medium">
              {outfit.items
                .map((i) => i.name)
                .filter(Boolean)
                .slice(0, 2)
                .join(' + ') || 'Today’s pick'}
            </h3>
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-chip font-medium text-white">
              {matchPercent(outfit.score)}% Match
            </span>
          </div>

          <h4 className="mb-2 text-meta font-semibold uppercase tracking-wide text-text-mute">
            Recommended Items
          </h4>
          <ul className="mb-4 grid grid-cols-4 gap-2">
            {outfit.items.map((item) => (
              <li key={item.id}>
                <ItemImage
                  src={data?.imageUrls[item.id]}
                  alt={item.name ?? 'Recommended item'}
                  width={110}
                  height={110}
                  className="aspect-square w-full rounded-[var(--radius)] object-cover"
                />
                <p className="mt-1 truncate text-chip text-text-mute">
                  {item.name ?? item.subtype ?? '—'}
                </p>
              </li>
            ))}
          </ul>

          {outfit.rationale && (
            <>
              <h4 className="mb-1 text-meta font-semibold uppercase tracking-wide text-text-mute">
                Style Notes
              </h4>
              <p className="text-body text-text-dim">{outfit.rationale}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
