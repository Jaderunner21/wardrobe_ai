'use client';

/**
 * Wardrobe filter bar — module 16 §4: search, Favourites toggle, sort select.
 *
 * Every control writes to the URL and lets the Server Component re-render. That keeps
 * the grid server-rendered (module 01 — lists render on the server), makes a filtered
 * wardrobe a shareable, back-buttonable address, and means there is exactly one place
 * that knows what "currently filtered to" means.
 */
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { Route } from 'next';
import { SORTS } from '@/app/api/items/schemas';

const SORT_LABELS: Record<(typeof SORTS)[number], string> = {
  recent: 'Newest first',
  'least-worn': 'Least worn',
  'recently-worn': 'Recently worn',
  'cost-per-wear': 'Cost per wear',
};

export function FilterBar({ total }: { total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(params.get('q') ?? '');
  const favourite = params.get('favourite') === 'true';
  const archived = params.get('archived') === 'true';
  const sort = params.get('sort') ?? 'recent';

  const push = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    // A filter change always returns to page one; a cursor from the old filter would
    // page into rows that no longer match.
    next.delete('cursor');
    const query = next.toString();
    startTransition(() => router.push((query ? `${pathname}?${query}` : pathname) as Route));
  };

  // Debounced search: a round trip per keystroke is a round trip per keystroke.
  useEffect(() => {
    const current = params.get('q') ?? '';
    if (q === current) return;
    const timer = setTimeout(() => {
      push((next) => (q ? next.set('q', q) : next.delete('q')));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3">
      <label htmlFor="wardrobe-search" className="sr-only">
        Search your wardrobe
      </label>
      <input
        id="wardrobe-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${total} item${total === 1 ? '' : 's'}…`}
        className="min-w-48 flex-1 rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-body text-text placeholder:text-text-mute"
      />

      <button
        type="button"
        aria-pressed={favourite}
        onClick={() => push((next) => (favourite ? next.delete('favourite') : next.set('favourite', 'true')))}
        className={[
          'rounded-[var(--radius)] px-3 py-2 text-meta font-medium transition-colors',
          favourite ? 'bg-brand-100 text-brand-700' : 'text-text-dim hover:bg-brand-50',
        ].join(' ')}
      >
        Favourites
      </button>

      <button
        type="button"
        aria-pressed={archived}
        onClick={() => push((next) => (archived ? next.delete('archived') : next.set('archived', 'true')))}
        className={[
          'rounded-[var(--radius)] px-3 py-2 text-meta font-medium transition-colors',
          archived ? 'bg-brand-100 text-brand-700' : 'text-text-dim hover:bg-brand-50',
        ].join(' ')}
      >
        Archived
      </button>

      <label htmlFor="wardrobe-sort" className="sr-only">
        Sort by
      </label>
      <select
        id="wardrobe-sort"
        value={sort}
        onChange={(e) => push((next) => next.set('sort', e.target.value))}
        className="rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-meta text-text"
      >
        {SORTS.map((option) => (
          <option key={option} value={option}>
            {SORT_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
