'use client';

/**
 * The list half of module 16 §4's grid/list toggle.
 *
 * Same information as `ItemCard`, laid out for scanning rather than for browsing: a
 * small thumbnail, then the fields in fixed columns so brand lines up under brand and
 * a wardrobe of sixty can be read down instead of across. It is the view that makes
 * "which of these have I never worn" answerable, which is why the sort selector and
 * this share a bar.
 *
 * Deliberately not a wrapper around `ItemCard` with different classes — the two have
 * different information hierarchies, and one component trying to be both is how a card
 * ends up with a list's density and a list with a card's whitespace.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ItemImage } from '@/components/ItemImage';
import { CategoryPill, ColorDot, ConditionDot, STYLE_LABELS } from '@/components/primitives';
import type { ItemListView } from '@/lib/mappers';
import type { Category } from '@/types';

export function ItemRow({
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
  const [worn, setWorn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = item.name ?? item.subtype ?? 'Untitled item';

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

  return (
    <article
      className={`flex items-center gap-4 rounded-[var(--radius)] border border-border bg-surface p-3 transition-opacity ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <Link href={{ pathname: `/wardrobe/${item.id}` }} className="shrink-0">
        <ItemImage
          src={imageUrl}
          alt={label}
          width={56}
          height={56}
          className="h-14 w-14 rounded-[var(--radius-sm)] object-cover"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={{ pathname: `/wardrobe/${item.id}` }}
          className="block truncate text-card font-medium hover:underline"
          title={label}
        >
          {label}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-text-dim">
          {category && <CategoryPill name={category.name} icon={category.icon} />}
          <span>{item.style ? STYLE_LABELS[item.style] : '—'}</span>
          <ColorDot hex={item.colorHex} name={item.primaryColor} />
          <ConditionDot condition={item.condition} />
        </div>
      </div>

      {/* The columns that make a list worth having: brand and wear count aligned down
          the page, which is the comparison a grid cannot show. */}
      <span className="hidden w-28 shrink-0 truncate text-right text-meta uppercase tracking-wide text-text-mute sm:block">
        {item.brand ?? ''}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-meta text-text-dim sm:block">
        {item.wearCount === 0 ? 'Never worn' : `${item.wearCount}×`}
      </span>

      <button
        type="button"
        onClick={woreToday}
        disabled={worn || pending}
        className="shrink-0 rounded-[var(--radius)] border border-border px-3 py-1.5 text-meta font-medium text-text transition-colors hover:bg-brand-50 disabled:opacity-60"
      >
        {worn ? 'Logged' : 'Wore Today'}
      </button>

      {error && (
        <p role="alert" className="text-meta text-danger-600">
          {error}
        </p>
      )}
    </article>
  );
}
