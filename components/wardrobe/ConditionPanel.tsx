'use client';

/**
 * Condition on the item detail page — module 18 §6.
 *
 * Current rating, the full history, and how many wears have passed since it was taken.
 * Always ratable from here, milestone or not: someone who noticed a hole today should
 * not have to wait for wear 25 to say so.
 *
 * THE LOG IS THE FEATURE (§2). `items.condition` is only the current value for display
 * and filtering; the series below it is where every insight comes from, each row
 * carrying the wear count at the moment of rating — which is what makes "still a 5 at
 * 40 wears" a sentence anyone can say. Rows are appended, never edited or deleted, so
 * this panel offers no way to change one.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ConditionRating, rateCondition } from '@/components/wardrobe/ConditionRating';
import {
  CONDITION_LABELS,
  CONDITION_SHORT,
  needsConditionRating,
  wearsSinceRating,
} from '@/lib/condition';
import { DEFAULT_DATE_FORMAT, formatDate } from '@/lib/format';
import type { Condition, ConditionLogEntry, DateFormat, Item } from '@/types';

export function ConditionPanel({
  item,
  history,
  dateFormat = DEFAULT_DATE_FORMAT,
}: {
  item: Pick<Item, 'id' | 'condition' | 'conditionRatedAt' | 'conditionAtWear' | 'wearCount'>;
  history: ConditionLogEntry[];
  dateFormat?: DateFormat;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const since = wearsSinceRating(item);
  const due = needsConditionRating(item);

  async function rate(level: Condition) {
    setBusy(true);
    setError(null);
    const saved = await rateCondition(item.id, level, note);
    setBusy(false);

    if (!saved) {
      setError('Could not save that rating.');
      return;
    }
    setNote('');
    startTransition(() => router.refresh());
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-section font-semibold tracking-tight">Condition</h2>
        <p className="text-meta text-text-mute">
          {item.condition === null
            ? 'Not rated yet'
            : `${CONDITION_LABELS[item.condition]}${
                since === null ? '' : ` · rated ${since} wear${since === 1 ? '' : 's'} ago`
              }`}
        </p>
      </div>

      {due && (
        <p className="mt-3 rounded-[var(--radius)] bg-brand-50 px-3 py-2 text-meta text-text-dim">
          {item.wearCount} wears in. How is it holding up?
        </p>
      )}

      <div className="mt-4">
        <ConditionRating value={item.condition} disabled={busy} onRate={rate} />
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-meta font-medium text-text-dim">
          Note (optional)
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Pilling at the elbows"
          maxLength={500}
          className="w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-body text-text placeholder:text-text-mute"
        />
      </label>

      {error && (
        <p role="alert" className="mt-2 text-meta text-danger-600">
          {error}
        </p>
      )}

      {history.length > 0 && (
        <ol className="mt-5 space-y-2 border-t border-border pt-4">
          {history.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-3 text-meta">
              <span className="text-text">
                {CONDITION_SHORT[entry.condition]}
                <span className="text-text-mute"> at {entry.wearCount} wears</span>
                {entry.note && <span className="text-text-dim"> — {entry.note}</span>}
              </span>
              <span className="shrink-0 text-text-mute">
                {formatDate(entry.createdAt, dateFormat)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
