'use client';

/**
 * Pages past the first — module 05 §3. Cursor-based, never offset.
 *
 * The first page is server-rendered HTML; this fetches the rest as JSON from
 * `GET /api/items`, which is exactly the split module 01 asks for: server for the
 * initial render, the route handler for interaction.
 */
import { useState } from 'react';
import { ItemCard } from '@/components/ItemCard';
import type { ItemListView } from '@/lib/mappers';
import type { Category } from '@/types';

interface Page {
  items: ItemListView[];
  nextCursor: string | null;
  imageUrls: Record<string, string>;
}

export function LoadMore({
  initialCursor,
  query,
  categories,
}: {
  initialCursor: string;
  /** The current filter state, already serialised — the cursor is added per request. */
  query: string;
  categories: Record<string, Pick<Category, 'name' | 'icon'>>;
}) {
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadNext() {
    if (!cursor) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams(query);
    params.set('cursor', cursor);

    try {
      const response = await fetch(`/api/items?${params.toString()}`);
      if (!response.ok) throw new Error('request failed');
      const page = (await response.json()) as Page;
      setPages((current) => [...current, page]);
      setCursor(page.nextCursor);
    } catch {
      // Inline retry, never a blank panel (module 16 §5).
      setError('Could not load more items.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {pages.flatMap((page) =>
        page.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            category={item.categoryId ? categories[item.categoryId] : undefined}
            imageUrl={page.imageUrls[item.id]}
          />
        )),
      )}

      {cursor && (
        <div className="col-span-full flex flex-col items-center gap-2 py-6">
          <button
            type="button"
            onClick={loadNext}
            disabled={loading}
            className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium text-text transition-colors hover:bg-brand-50 disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
          {error && (
            <p role="alert" className="text-meta text-danger-600">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
