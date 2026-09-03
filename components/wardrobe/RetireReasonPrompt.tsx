'use client';

/**
 * "Why is it leaving?" — module 18 §5.
 *
 * One tap, seven options, and SKIPPABLE: the button's job is to remove the item, so
 * refusing to do that until a reason is given would be the wrong trade. Skip proceeds
 * with no reason recorded, which is an honest null rather than a guessed `other`.
 *
 * Cheap to collect and each answer means something different. `worn_out` is the
 * strongest durability signal there is; `disliked` feeds the style profile;
 * `no_longer_fits` is a size-change signal; `donated` is where the donation network
 * starts. None of it reaches analytics.
 */
import { RETIRED_REASON_LABELS } from '@/lib/condition';
import { RETIRED_REASONS } from '@/app/api/items/schemas';
import type { RetiredReason } from '@/types';

export function RetireReasonPrompt({
  title,
  busy,
  onChoose,
  onCancel,
}: {
  title: string;
  busy?: boolean;
  onChoose: (reason: RetiredReason | null) => void;
  onCancel?: () => void;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
      <p className="mb-2 text-meta font-medium text-text">{title}</p>

      <div className="flex flex-wrap gap-1.5">
        {RETIRED_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            disabled={busy}
            onClick={() => onChoose(reason)}
            className="rounded-full bg-bg px-3 py-1.5 text-chip font-medium text-text-dim transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-60"
          >
            {RETIRED_REASON_LABELS[reason]}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onChoose(null)}
          className="text-meta font-medium text-brand-700 underline underline-offset-4 disabled:opacity-60"
        >
          Skip
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="text-meta text-text-mute hover:text-text disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
