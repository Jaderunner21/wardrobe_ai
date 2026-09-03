/**
 * Cost per wear — module 17. Pure.
 *
 * This is what gives wear-tracking a point. "Wore Today" on its own is a chore with no
 * payoff; "your ₹4,200 boots are now down to ₹140 a wear" is a reason to tap it.
 *
 * A TARGET, NOT A VERDICT. The number is framed as progress toward a goal the user
 * chose, never as a judgement on a purchase. An app that tells someone their spending
 * was a mistake is unpleasant to use, and nobody needs a wardrobe app for that. Where a
 * flag is genuinely useful it stays factual and actionable — "not worn in 6 months" is
 * something to act on; "this wasn't worth it" is a verdict they did not ask for.
 */
import type { CostPerWear, Item, Profile } from '@/types';
import { DEFAULT_CPW_TARGET } from '@/types';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.44;

/** An item nobody has worn in this long is worth surfacing as a fact (module 17 §2). */
export const STALE_AFTER_DAYS = 182;

export function costPerWear(
  item: Pick<Item, 'price' | 'wearCount' | 'cpwTarget' | 'purchasedOn'>,
  profile: Pick<Profile, 'cpwTarget'>,
  today: Date = new Date(),
): CostPerWear {
  const target = item.cpwTarget ?? profile.cpwTarget ?? DEFAULT_CPW_TARGET;

  // An unworn item's cost per wear is its full price, not a division by zero — and
  // that is also the honest number.
  const cpw = item.price === null ? null : item.price / Math.max(item.wearCount, 1);

  const wearsToTarget =
    item.price === null || target <= 0
      ? null
      : Math.max(0, Math.ceil(item.price / target - item.wearCount));

  const daysOwned = daysSince(item.purchasedOn, today);

  return {
    cpw,
    wears: item.wearCount,
    target,
    wearsToTarget,
    reachedTarget: cpw !== null && cpw <= target,
    daysOwned,
    wearsPerMonth:
      daysOwned === null || daysOwned <= 0
        ? null
        : item.wearCount / (daysOwned / DAYS_PER_MONTH),
  };
}

export function daysSince(isoDate: string | null, today: Date = new Date()): number | null {
  if (!isoDate) return null;
  const then = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;

  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((now - then) / MS_PER_DAY));
}

/** 0..1, for the progress bar. Past target stays full rather than overflowing. */
export function targetProgress(cost: CostPerWear): number {
  if (cost.cpw === null) return 0;
  if (cost.reachedTarget) return 1;

  const needed = cost.wears + (cost.wearsToTarget ?? 0);
  return needed <= 0 ? 0 : Math.min(1, cost.wears / needed);
}

/**
 * Money is formatted at display time from the profile's currency, never stored as a
 * string — `price` is `numeric(12,2)` and stays a number all the way to the screen
 * (module 17 §6).
 */
export function formatMoney(
  amount: number | null,
  currency: string | null | undefined,
  locale = 'en-IN',
): string {
  if (amount === null) return '—';
  const code = (currency ?? 'INR').toUpperCase();

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    // An invalid currency code must not take the item page down.
    return `${code} ${amount.toFixed(2)}`;
  }
}

/** "Not worn in 6 months" — a fact the user can act on, not a judgement. */
export function isStale(
  item: Pick<Item, 'lastWornOn' | 'createdAt' | 'wearCount'>,
  today: Date = new Date(),
): boolean {
  const reference = item.lastWornOn ?? item.createdAt;
  const days = daysSince(reference, today);
  return days !== null && days >= STALE_AFTER_DAYS;
}
