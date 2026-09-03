'use client';

/**
 * The five-level rating control — module 18 §1.
 *
 * Levels are worded, not starred: "Worn but fine" means the same thing to two people
 * in a way that "3 out of 5" does not, and the whole retailer signal depends on two
 * users meaning the same thing by the same number.
 *
 * Shared by the prompt on the card and the panel on the detail page, so there is one
 * place that knows what the levels say.
 */
import { CONDITION_LABELS } from '@/lib/condition';
import type { Condition } from '@/types';

const LEVELS: Condition[] = [5, 4, 3, 2, 1];

export function ConditionRating({
  value,
  disabled,
  onRate,
}: {
  value: Condition | null;
  disabled?: boolean;
  onRate: (condition: Condition) => void;
}) {
  return (
    <div role="radiogroup" aria-label="How is this holding up?" className="flex flex-wrap gap-1.5">
      {LEVELS.map((level) => {
        const selected = value === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onRate(level)}
            className={[
              'rounded-full px-3 py-1.5 text-chip font-medium transition-colors disabled:opacity-60',
              selected
                ? 'bg-brand-500 text-white'
                : 'bg-bg text-text-dim hover:bg-brand-50 hover:text-brand-700',
            ].join(' ')}
          >
            {CONDITION_LABELS[level]}
          </button>
        );
      })}
    </div>
  );
}

/** POST the rating. `rate_condition()` appends the log row and updates the item. */
export async function rateCondition(
  itemId: string,
  condition: Condition,
  note?: string,
): Promise<boolean> {
  const response = await fetch(`/api/items/${itemId}/condition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ condition, note: note?.trim() || null }),
  });
  return response.ok;
}
