'use client';

/**
 * Wardrobe card — module 16 §3's anatomy: image with hover actions top-right, tag
 * chips over the bottom-left, then title, category pill and brand, style and colour,
 * seasons.
 *
 * "Wore Today" is one tap on the thing the user is already looking at, which is better
 * than routing wear-tracking through outfits (module 16 §3). It posts a `worn` feedback
 * row; `log_wear` is idempotent per day, so a second tap is a no-op rather than a
 * double count.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ItemImage } from '@/components/ItemImage';
import { CategoryPill, ColorDot, TagChip, seasonSummary, STYLE_LABELS } from '@/components/primitives';
import { TrashIcon } from '@/components/icons';
import type { ItemListView } from '@/lib/mappers';
import type { Category } from '@/types';

export function ItemCard({
  item,
  category,
  imageUrl,
}: {
  item: ItemListView;
  category?: Pick<Category, 'name' | 'icon'>;
  imageUrl?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [favourite, setFavourite] = useState(item.favourite);
  const [worn, setWorn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function woreToday() {
    setError(null);
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, kind: 'worn' }),
    });

    if (!response.ok) {
      setError('Could not log that.');
      return;
    }
    setWorn(true);
    startTransition(() => router.refresh());
  }

  const label = item.name ?? item.subtype ?? 'Untitled item';

  async function toggleFavourite() {
    const next = !favourite;
    setFavourite(next); // optimistic — a heart that lags feels broken
    const response = await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ favourite: next }),
    });
    if (!response.ok) {
      setFavourite(!next);
      setError('Could not save that.');
      return;
    }
    startTransition(() => router.refresh());
  }

  async function moveToBin() {
    const response = await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not move that to the bin.');
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <article
      className={`group overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-card)] transition-opacity ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <div className="relative aspect-square">
        <ItemImage src={imageUrl} alt={label} className="h-full w-full object-cover" />

        {/* Hover actions. Always visible on touch, where there is no hover. */}
        <div className="absolute right-2 top-2 flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <button
            type="button"
            onClick={toggleFavourite}
            aria-pressed={favourite}
            aria-label={favourite ? `Unfavourite ${label}` : `Favourite ${label}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 text-text-dim backdrop-blur-sm hover:text-favourite"
          >
            <HeartGlyph filled={favourite} />
          </button>
          <button
            type="button"
            onClick={moveToBin}
            aria-label={`Move ${label} to the bin`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 text-text-dim backdrop-blur-sm hover:text-danger-600"
          >
            <TrashIcon size={16} />
          </button>
        </div>

        {item.userTags.length > 0 && (
          <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] gap-1">
            <TagChip
              label={item.userTags[0] ?? ''}
              more={item.userTags.length > 1 ? item.userTags.length - 1 : undefined}
            />
          </div>
        )}
      </div>

      <div className="space-y-2 p-4">
        <Link
          href={{ pathname: `/wardrobe/${item.id}` }}
          className="block truncate text-card font-medium hover:underline"
          title={label}
        >
          {label}
        </Link>

        <div className="flex items-center justify-between gap-2">
          {category ? <CategoryPill name={category.name} icon={category.icon} /> : <span />}
          {item.brand && (
            <span className="truncate text-meta uppercase tracking-wide text-text-mute">
              {item.brand}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-meta text-text-dim">
          <span>{item.style ? STYLE_LABELS[item.style] : '—'}</span>
          <ColorDot hex={item.colorHex} name={item.primaryColor} />
        </div>

        <p className="text-meta text-text-mute">{seasonSummary(item.seasons)}</p>

        <button
          type="button"
          onClick={woreToday}
          disabled={worn || pending}
          className="w-full rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-meta font-medium text-text transition-colors hover:bg-brand-50 disabled:opacity-60"
        >
          {worn ? 'Logged for today' : 'Wore Today'}
        </button>

        {error && (
          <p role="alert" className="text-meta text-danger-600">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

function HeartGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? 'var(--favourite)' : 'none'}
      stroke={filled ? 'var(--favourite)' : 'currentColor'}
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 7a4 4 0 0 1 7 3.7C19 15.6 12 20 12 20Z" />
    </svg>
  );
}
