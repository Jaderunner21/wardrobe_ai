'use client';

/**
 * An outfit card — module 16 §4: title, context chips, item thumbnails with their
 * category labels, and a "Why This Works" panel.
 *
 * The thumbs up/down the prototype shows belong to module 10 and arrive with it. A
 * button that does nothing is worse than a button that is not there yet.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ItemImage } from '@/components/ItemImage';
import { SEASON_LABELS, STYLE_LABELS } from '@/components/primitives';
import type { OutfitWithItems } from '@/lib/outfits';
import { matchPercent, type Slot } from '@/types';

const SLOT_LABELS: Record<Slot, string> = {
  top: 'Top',
  bottom: 'Bottom',
  fullbody: 'Full outfit',
  outerwear: 'Layer',
  footwear: 'Shoes',
  accessory: 'Accessory',
};

export function OutfitCard({
  outfit,
  imageUrls,
  onSave,
  saving,
}: {
  outfit: OutfitWithItems;
  /** Keyed by item id, signed server-side in one batch (module 04 §6). */
  imageUrls: Record<string, string>;
  /** Present on a generated card; absent once the outfit is already stored. */
  onSave?: () => void;
  saving?: boolean;
}) {
  const router = useRouter();
  const [planning, setPlanning] = useState(false);
  const [plannedFor, setPlannedFor] = useState(outfit.plannedFor ?? '');
  const [error, setError] = useState<string | null>(null);

  const title =
    outfit.items
      .map((i) => i.item?.name)
      .filter(Boolean)
      .slice(0, 2)
      .join(' + ') || 'Outfit';

  async function plan(date: string) {
    setPlanning(true);
    setError(null);
    const response = await fetch(`/api/outfits/${outfit.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plannedFor: date || null, saved: true }),
    });
    if (!response.ok) setError('Could not plan that.');
    else router.refresh();
    setPlanning(false);
  }

  async function remove() {
    const response = await fetch(`/api/outfits/${outfit.id}`, { method: 'DELETE' });
    if (!response.ok) setError('Could not remove that.');
    else router.refresh();
  }

  return (
    <article className="flex flex-col rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-card font-medium">{title}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {outfit.style && <Chip>{STYLE_LABELS[outfit.style]}</Chip>}
            {outfit.season && <Chip>{SEASON_LABELS[outfit.season]}</Chip>}
            {outfit.source === 'manual' && <Chip>Yours</Chip>}
          </div>
        </div>

        {outfit.score != null && (
          // The engine's raw scores sit in 0.70-0.85; this is the display mapping from
          // module 16 §7.5, not a retuned weight.
          <span className="shrink-0 rounded-full bg-brand-600 px-2.5 py-1 text-chip font-medium text-white">
            {matchPercent(outfit.score)}% Match
          </span>
        )}
      </header>

      <div className="grid grid-cols-4 gap-2">
        {outfit.items.map(({ itemId, slot, item }) => (
          <figure key={itemId} className="min-w-0">
            <ItemImage
              src={imageUrls[itemId]}
              alt={item?.name ?? SLOT_LABELS[slot]}
              width={120}
              height={120}
              className="aspect-square w-full rounded-[var(--radius)] object-cover"
            />
            <figcaption className="mt-1 truncate text-chip text-text-mute">
              {SLOT_LABELS[slot]}
            </figcaption>
          </figure>
        ))}
      </div>

      {outfit.rationale && (
        <section className="mt-3 rounded-[var(--radius)] bg-brand-50 p-3">
          <h4 className="text-chip font-semibold uppercase tracking-wide text-brand-800">
            Why This Works
          </h4>
          <p className="mt-1 text-meta text-text-dim">{outfit.rationale}</p>
        </section>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-[var(--radius)] bg-brand-500 px-3 py-1.5 text-meta font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save outfit'}
          </button>
        )}

        {!onSave && (
          <>
            <label className="flex items-center gap-2 text-meta text-text-dim">
              Plan for
              <input
                type="date"
                value={plannedFor}
                disabled={planning}
                onChange={(e) => {
                  setPlannedFor(e.target.value);
                  void plan(e.target.value);
                }}
                className="rounded-[var(--radius)] border border-border bg-bg px-2 py-1 text-meta text-text"
              />
            </label>
            <button
              type="button"
              onClick={remove}
              className="ml-auto rounded-[var(--radius)] px-3 py-1.5 text-meta font-medium text-danger-600 hover:bg-danger-50"
            >
              Remove
            </button>
          </>
        )}
      </footer>

      {error && (
        <p role="alert" className="mt-2 text-meta text-danger-600">
          {error}
        </p>
      )}
    </article>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800">
    {children}
  </span>
);
