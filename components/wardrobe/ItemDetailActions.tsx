'use client';

/**
 * Actions on the item detail page — module 05 §5, module 18 §3b and §5.
 *
 * Archive is offered before delete, deliberately: archiving keeps the row, the image
 * and the wear history, so outfits referencing the garment do not break. Deletion sends
 * it to the Bin, where it is recoverable for 30 days.
 *
 * A wear is one tap and it is UNDOABLE (§3b). The button is easy to hit twice, and
 * `log_wear` being idempotent per day covers the double tap, but a wear logged against
 * the wrong garment needs a way back — so "Undo" appears next to it, and calls
 * `undo_wear`, which recalculates `last_worn_on` from the wears that remain rather than
 * guessing.
 *
 * Both exits ask WHY, and both accept "Skip": the reason is worth collecting — worn_out
 * is the strongest durability signal there is — but not worth blocking the exit for.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { RetireReasonPrompt } from '@/components/wardrobe/RetireReasonPrompt';
import type { RetiredReason } from '@/types';

type Exit = 'archive' | 'bin';

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
  const [asking, setAsking] = useState<Exit | null>(null);
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

  /**
   * The feedback route rather than /wore: a wear is also a preference signal, and that
   * path feeds the style profile as well as calling `log_wear`.
   */
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

  async function undoWear() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/items/${itemId}/wore`, { method: 'DELETE' });
    if (!response.ok) setError('Could not undo that.');
    else {
      setWorn(false);
      startTransition(() => router.refresh());
    }
    setBusy(false);
  }

  async function archive(reason: RetiredReason | null) {
    setAsking(null);
    await patch({ archived: true, ...(reason ? { retiredReason: reason } : {}) }, () =>
      setArchived(true),
    );
  }

  async function bin(reason: RetiredReason | null) {
    setAsking(null);
    setBusy(true);
    const query = reason ? `?reason=${reason}` : '';
    const response = await fetch(`/api/items/${itemId}${query}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not move that to the bin.');
      setBusy(false);
      return;
    }
    router.push('/wardrobe');
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={woreToday}
          disabled={busy || worn}
          className="rounded-[var(--radius)] bg-brand-500 px-3 py-2 text-meta font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {worn ? 'Logged for today' : 'Wore Today'}
        </button>

        {worn && (
          <button
            type="button"
            onClick={undoWear}
            disabled={busy}
            className="rounded-[var(--radius)] px-2 py-2 text-meta font-medium text-brand-700 underline underline-offset-4 disabled:opacity-60"
          >
            Undo
          </button>
        )}

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
          onClick={() =>
            isArchived ? patch({ archived: false }, () => setArchived(false)) : setAsking('archive')
          }
          disabled={busy}
          className="rounded-[var(--radius)] border border-border px-3 py-2 text-meta font-medium hover:bg-brand-50 disabled:opacity-60"
        >
          {isArchived ? 'Unarchive' : 'Archive'}
        </button>

        <button
          type="button"
          onClick={() => setAsking('bin')}
          disabled={busy}
          className="rounded-[var(--radius)] px-3 py-2 text-meta font-medium text-danger-600 hover:bg-danger-50 disabled:opacity-60"
        >
          Move to bin
        </button>
      </div>

      {asking && (
        <div className="mt-3">
          <RetireReasonPrompt
            title={asking === 'bin' ? 'Why is it going?' : 'Why are you archiving it?'}
            busy={busy}
            onChoose={asking === 'bin' ? bin : archive}
            onCancel={() => setAsking(null)}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-meta text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
