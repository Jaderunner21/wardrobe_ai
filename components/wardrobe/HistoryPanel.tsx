/**
 * The History panel on the item detail page — module 17 §5.
 *
 * Progress toward a target the user set, never a verdict on the purchase. An item with
 * no price shows its wear count and nothing else: no empty state, no guilt, no prompt
 * to go and fill in a form.
 */
import { costPerWear, formatMoney, isStale, targetProgress } from '@/lib/cpw';
import { confidenceNote } from '@/lib/condition';
import type { Item, Profile } from '@/types';

export function HistoryPanel({
  item,
  profile,
}: {
  item: Item;
  profile: Pick<Profile, 'cpwTarget' | 'currency'>;
}) {
  const cost = costPerWear(item, profile);
  // Module 18 §3b: a cost-per-wear standing on a remembered 80 is still worth showing,
  // but presenting it as measured is not.
  const caveat = confidenceNote(item);
  const currency = item.currency ?? profile.currency;
  const progress = targetProgress(cost);
  const stale = isStale(item);

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <h2 className="text-section font-semibold tracking-tight">History</h2>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat label="Worn" value={cost.wears === 0 ? 'Never' : `${cost.wears}×`} />
        <Stat
          label="Last worn"
          value={item.lastWornOn ? new Date(item.lastWornOn).toLocaleDateString() : '—'}
        />
        <Stat
          label="Owned"
          value={cost.daysOwned === null ? '—' : `${cost.daysOwned} days`}
        />

        {item.price !== null && (
          <>
            <Stat label="Paid" value={formatMoney(item.price, currency)} />
            <Stat label="Per wear" value={formatMoney(cost.cpw, currency)} />
            <Stat
              label="Wears / month"
              value={cost.wearsPerMonth === null ? '—' : cost.wearsPerMonth.toFixed(1)}
            />
          </>
        )}

        {item.retailer && <Stat label="From" value={item.retailer} />}
        {item.purchasedOn && (
          <Stat label="Bought" value={new Date(item.purchasedOn).toLocaleDateString()} />
        )}
      </dl>

      {item.price !== null && (
        <div className="mt-5">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress toward your cost-per-wear target"
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>

          <p className="mt-2 text-meta text-text-dim">
            {cost.reachedTarget ? (
              <>
                Past your {formatMoney(cost.target, currency)} target — every wear from here
                is profit.
              </>
            ) : (
              <>
                {cost.wearsToTarget} more wear{cost.wearsToTarget === 1 ? '' : 's'} to reach
                your {formatMoney(cost.target, currency)} target.
              </>
            )}
          </p>
        </div>
      )}

      {caveat && item.price !== null && (
        <p className="mt-2 text-meta text-text-mute">{caveat}.</p>
      )}

      {stale && (
        <p className="mt-4 rounded-[var(--radius)] bg-brand-50 px-3 py-2 text-meta text-text-dim">
          Not worn in six months.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta text-text-mute">{label}</dt>
      <dd className="mt-0.5 text-body text-text">{value}</dd>
    </div>
  );
}
