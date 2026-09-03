'use client';

/**
 * "Generate Outfit Recommendation" → "Your Style Recommendations" — module 16 §4.
 *
 * Generated outfits are not persisted until the user saves one. The engine is free and
 * deterministic per wardrobe version, so regenerating costs nothing and returns the
 * same answer — which is why the list does not shuffle between refreshes for no visible
 * reason (module 08 §5).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OutfitCard } from '@/components/outfits/OutfitCard';
import { EmptyState } from '@/components/primitives';
import { SparkleIcon } from '@/components/icons';
import { STYLES } from '@/app/api/items/schemas';
import { STYLE_LABELS } from '@/components/primitives';
import type { OutfitWithItems } from '@/lib/outfits';
import type { ApiError, Item, Recommendation, Style, WeatherContext } from '@/types';

interface Response {
  recommendations: Recommendation[];
  weather: WeatherContext | null;
  cached: boolean;
  source: 'rules' | 'llm';
  reason: string | null;
  /** item id → signed thumbnail, signed server-side in one batch. */
  imageUrls: Record<string, string>;
}

export function Recommendations() {
  const router = useRouter();
  const [style, setStyle] = useState<Style>('casual');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Response | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(refresh = false) {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ style, limit: '5' });
      if (refresh) params.set('refresh', 'true');

      const response = await fetch(`/api/recommendations?${params.toString()}`);
      if (!response.ok) throw await response.json().catch(() => null);

      const body = (await response.json()) as Response;
      setResult(body);
      setImages(body.imageUrls ?? {});
    } catch (e) {
      const api = e as ApiError | null;
      setError(api?.error?.message ?? 'Could not build recommendations.');
    } finally {
      setLoading(false);
    }
  }

  async function save(recommendation: Recommendation) {
    const key = recommendation.items.map((i) => i.id).join(':');
    setSavingId(key);

    const response = await fetch('/api/outfits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        itemIds: recommendation.items.map((i) => i.id),
        slots: recommendation.slots,
        style,
        tempBucket: result?.weather?.tempBucket ?? null,
        source: recommendation.source,
        score: recommendation.score,
        rationale: recommendation.rationale,
        saved: true,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? 'Could not save that outfit.');
    } else {
      router.refresh();
    }
    setSavingId(null);
  }

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="rec-style" className="sr-only">
          Style
        </label>
        <select
          id="rec-style"
          value={style}
          onChange={(e) => setStyle(e.target.value as Style)}
          className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-meta text-text"
        >
          {STYLES.map((s) => (
            <option key={s} value={s}>
              {STYLE_LABELS[s]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => generate(false)}
          disabled={loading}
          className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {loading ? 'Thinking…' : 'Generate Outfit Recommendation'}
        </button>

        {result && (
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={loading}
            className="rounded-[var(--radius)] border border-border px-3 py-2 text-meta font-medium hover:bg-brand-50 disabled:opacity-60"
          >
            Refresh
          </button>
        )}

        {result?.weather && (
          <span className="text-meta text-text-mute">
            {Math.round(result.weather.tempMinC)}–{Math.round(result.weather.tempMaxC)}° ·{' '}
            {result.weather.condition}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-[var(--radius)] bg-danger-50 px-4 py-3 text-meta text-danger-600">
          {error}
        </p>
      )}

      {result && result.recommendations.length === 0 && (
        <EmptyState
          icon={<SparkleIcon size={26} />}
          title="Nothing to suggest yet"
          line={result.reason ?? 'Add a few more items to get outfit suggestions.'}
        />
      )}

      {result && result.recommendations.length > 0 && (
        <>
          <h2 className="mb-3 text-section font-semibold tracking-tight">
            Your Style Recommendations
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {result.recommendations.map((r) => {
              const key = r.items.map((i) => i.id).join(':');
              return (
                <OutfitCard
                  key={key}
                  outfit={asOutfit(r, style, result.weather?.tempBucket ?? null)}
                  imageUrls={images}
                  onSave={() => save(r)}
                  saving={savingId === key}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/** A generated recommendation, shaped like a stored outfit so one card renders both. */
function asOutfit(
  recommendation: Recommendation,
  style: Style,
  tempBucket: number | null,
): OutfitWithItems {
  return {
    id: `generated:${recommendation.items.map((i) => i.id).join(':')}`,
    userId: '',
    source: recommendation.source,
    style,
    season: null,
    tempBucket: (tempBucket ?? null) as OutfitWithItems['tempBucket'],
    score: recommendation.score,
    rationale: recommendation.rationale,
    saved: false,
    plannedFor: null,
    createdAt: '',
    items: recommendation.items.map((item: Item, index) => ({
      itemId: item.id,
      slot: recommendation.slots[index] ?? item.slot ?? 'top',
      item: {
        id: item.id,
        status: item.status,
        thumbPath: item.thumbPath,
        name: item.name,
        categoryId: item.categoryId,
        slot: item.slot,
        style: item.style,
        brand: item.brand,
        subtype: item.subtype,
        primaryColor: item.primaryColor,
        colorHex: item.colorHex,
        formality: item.formality,
        warmth: item.warmth,
        seasons: item.seasons,
        userTags: item.userTags,
        favourite: item.favourite,
        archived: item.archived,
        wearCount: item.wearCount,
        condition: item.condition,
        conditionAtWear: item.conditionAtWear,
      },
    })),
  };
}
