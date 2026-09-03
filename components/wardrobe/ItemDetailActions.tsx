'use client';

/**
 * Actions on the item detail page — module 05 §5.
 *
 * Archive is offered before delete, deliberately: archiving keeps the row, the image
 * and the wear history, so outfits referencing the garment do not break. Deletion sends
 * it to the Bin, where it is recoverable for 30 days.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function ItemDetailActions({
  itemId,
  archived,
  favourite,
}: {
  itemId: string;
  archived: boolean;
  favourite: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [isArchived, setArchived] = useState(archived);
  const [isFavourite, setFavourite] = useState(favourite);
  const [worn, setWorn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, after: () => void) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) setError('That did not save.');
    else {
      after();
      startTransition(() => router.refresh());
    }
    setBusy(false);
  }

  async function woreToday() {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId, kind: 'worn' }),
    });
    if (!response.ok) setError('Could not log that.');
    else {
      setWorn(true);
      startTransition(() => router.refresh());
    }
    setBusy(false);
  }

  async function bin() {
    setBusy(true);
    const response = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not move that to the bin.');
      setBusy(false);
      return;
    }
    router.push('/wardrobe');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={woreToday}
        disabled={busy || worn}
        className="rounded-[var(--radius)] bg-brand-500 px-3 py-2 text-meta font-medium text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {worn ? 'Logged for today' : 'Wore Today'}
      </button>

      <button
        type="button"
        onClick={() => patch({ favourite: !isFavourite }, () => setFavourite(!isFavourite))}
        disabled={busy}
        aria-pressed={isFavourite}
        className="rounded-[var(--radius)] border border-border px-3 py-2 text-meta font-medium hover:bg-brand-50 disabled:opacity-60"
      >
        {isFavourite ? '♥ Favourite' : '♡ Favourite'}
      </button>

      <button
        type="button"
        onClick={() => patch({ archived: !isArchived }, () => setArchived(!isArchived))}
        disabled={busy}
        className="rounded-[var(--radius)] border border-border px-3 py-2 text-meta font-medium hover:bg-brand-50 disabled:opacity-60"
      >
        {isArchived ? 'Unarchive' : 'Archive'}
      </button>

      <button
        type="button"
        onClick={bin}
        disabled={busy}
        className="rounded-[var(--radius)] px-3 py-2 text-meta font-medium text-danger-600 hover:bg-danger-50 disabled:opacity-60"
      >
        Move to bin
      </button>

      {error && (
        <p role="alert" className="w-full text-meta text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
