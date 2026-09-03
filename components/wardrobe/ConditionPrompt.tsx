'use client';

/**
 * The milestone prompt — module 18 §3.
 *
 * ONE dismissible tap, on the card the user is already looking at, and only at a
 * milestone: 10 wears, then every 15 since the last rating. Asking after every wearing
 * turns a useful feature into a chore and people stop tapping "Wore Today" — which
 * costs you cost-per-wear and the recency signal as well as the condition series.
 *
 * Dismissal is local and deliberately not persisted: it hides the prompt for this
 * session, and the milestone comes round again next time. Storing "don't ask about this
 * one" would need a column, and the honest version of that is rating it.
 */
import { useState } from 'react';
import { ConditionRating, rateCondition } from '@/components/wardrobe/ConditionRating';
import type { Condition } from '@/types';

export function ConditionPrompt({
  itemId,
  condition,
  onRated,
}: {
  itemId: string;
  condition: Condition | null;
  onRated?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (dismissed) return null;

  async function rate(level: Condition) {
    setBusy(true);
    setFailed(false);
    const saved = await rateCondition(itemId, level);
    setBusy(false);

    if (!saved) {
      setFailed(true);
      return;
    }
    setDismissed(true);
    onRated?.();
  }

  return (
    <div className="rounded-[var(--radius)] bg-brand-50 p-2.5">
      {open ? (
        <>
          <p className="mb-2 text-meta text-text-dim">How is it holding up?</p>
          <ConditionRating value={condition} disabled={busy} onRate={rate} />
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-left text-meta font-medium text-brand-700 underline underline-offset-4"
          >
            How is this holding up?
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Not now"
            className="shrink-0 rounded-full px-1.5 text-meta text-text-mute hover:text-text"
          >
            ×
          </button>
        </div>
      )}

      {failed && (
        <p role="alert" className="mt-1 text-meta text-danger-600">
          Could not save that rating.
        </p>
      )}
    </div>
  );
}
