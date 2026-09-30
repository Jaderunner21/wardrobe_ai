/**
 * Settings → Profile: what plan you are on — module 13 §4.
 *
 * A Server Component, and it reads the plan from the database rather than from anything
 * the browser knows. That is the same rule §1 states for writes, applied to reads: the
 * client does not get to have an opinion about which plan it is on.
 *
 * Until billing is switched on every feature is on every plan, so this says so plainly
 * instead of showing an upgrade button that would do nothing. A paywall that cannot take
 * money is worse than no paywall — it advertises a thing you cannot buy.
 */
import { formatDate } from '@/lib/format';
import type { DateFormat, Plan } from '@/types';

export function PlanPanel({
  plan,
  renewsAt,
  billingEnabled,
  itemCap,
  itemCount,
  dateFormat,
}: {
  plan: Plan;
  renewsAt: string | null;
  /** False until Razorpay keys are configured — module 13's whole module is PROD scope. */
  billingEnabled: boolean;
  /** null means no cap on this plan, which is the current configuration for both. */
  itemCap: number | null;
  itemCount: number;
  dateFormat: DateFormat;
}) {
  return (
    <section className="mt-6 rounded-[var(--radius)] border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-card font-medium">
          <span className="capitalize">{plan}</span> plan
        </h3>
        {renewsAt && (
          <p className="text-meta text-text-mute">
            Renews {formatDate(renewsAt, dateFormat)}
          </p>
        )}
      </div>

      <p className="mt-1 text-meta text-text-dim">
        {itemCap === null
          ? `Every feature is on, with no limit on how many items you keep. You have ${itemCount}.`
          : `${itemCount} of ${itemCap} items.`}
      </p>

      {!billingEnabled && (
        <p className="mt-3 text-meta text-text-mute">Every feature is included, free.</p>
      )}
    </section>
  );
}
