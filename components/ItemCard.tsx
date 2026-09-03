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
 *
 * Module 18 adds two things to the card and no more. A condition mark, but only at 2 or
 * below, so failing garments are visible while browsing (§6). And the milestone rating
 * prompt (§3) — at 10 wears, then every 15 since the last rating, never every wear,
 * because a card that asks a question every time is a card people stop tapping.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ItemImage } from '@/components/ItemImage';
import {
  CategoryPill,
  ColorDot,
  ConditionDot,
  TagChip,
  seasonSummary,
  STYLE_LABELS,
} from '@/components/primitives';
import { TrashIcon } from '@/components/icons';
import { ConditionPrompt } from '@/components/wardrobe/ConditionPrompt';
import { RetireReasonPrompt } from '@/components/wardrobe/RetireReasonPrompt';
import { needsConditionRating } from '@/lib/condition';
import type { ItemListView } from '@/lib/mappers';
import type { Category, RetiredReason } from '@/types';

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
  const [asking, setAsking] = useState(false);
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

  /**
   * Module 18 §3b — mis-taps. The button sits on the card and is easy to hit by
   * accident, or on the wrong garment, and one tap should always be undoable.
   * `undo_wear` removes today's entry and recalculates `last_worn_on` from the wears
   * that remain rather than guessing at it.
   */
  async function undoWear() {
    setError(null);
    const response = await fetch(`/api/items/${item.id}/wore`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not undo that.');
      return;
    }
    setWorn(false);
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

  // Module 18 §5: one tap to say why, and Skip is a first-class answer.
  async function moveToBin(reason: RetiredReason | null) {
    setAsking(false);
    const query = reason ? `?reason=${reason}` : '';
    const response = await fetch(`/api/items/${item.id}${query}`, { method: 'DELETE' });
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
          <Link
            href={{ pathname: `/wardrobe/${item.id}` }}
            aria-label={`Edit ${label}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 text-text-dim backdrop-blur-sm hover:text-brand-700"
          >
            <PencilGlyph />
          </Link>
          <button
            type="button"
            onClick={() => setAsking(true)}
            aria-label={`Move ${label} to the bin`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 text-text-dim backdrop-blur-sm hover:text-danger-600"
          >
            <TrashIcon size={16} />
          </button>
        </div>

        <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
          {item.userTags.length > 0 && (
            <TagChip
              label={item.userTags[0] ?? ''}
              more={item.userTags.length > 1 ? item.userTags.length - 1 : undefined}
            />
          )}
          <ConditionDot condition={item.condition} />
        </div>
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

        {worn ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-[var(--radius)] bg-brand-50 px-3 py-2 text-center text-meta font-medium text-brand-700">
              Logged for today
            </span>
            <button
              type="button"
              onClick={undoWear}
              disabled={pending}
              className="shrink-0 rounded-[var(--radius)] px-2 py-2 text-meta font-medium text-brand-700 underline underline-offset-4 disabled:opacity-60"
            >
              Undo
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={woreToday}
            disabled={pending}
            className="w-full rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-meta font-medium text-text transition-colors hover:bg-brand-50 disabled:opacity-60"
          >
            Wore Today
          </button>
        )}

        {needsConditionRating(item) && (
          <ConditionPrompt
            itemId={item.id}
            condition={item.condition}
            onRated={() => startTransition(() => router.refresh())}
          />
        )}

        {asking && (
          <RetireReasonPrompt
            title="Why is it going?"
            onChoose={moveToBin}
            onCancel={() => setAsking(false)}
          />
        )}

        {error && (
          <p role="alert" className="text-meta text-danger-600">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

function PencilGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
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
