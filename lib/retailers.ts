/**
 * Retailer durability — module 18 §4. The thing the whole feature is for.
 *
 *   your items from CheapShop  →  3 items, avg 15 wears, decline at ~12 wears
 *   your items from GoodShop   →  3 items, avg 82 wears, decline at ~75 wears
 *
 * FRAMED AS THE USER'S OWN RECORD, never a public rating of a shop (§4). "Your items
 * from X have averaged 15 wears" is a fact about their wardrobe; "X sells bad clothes"
 * is a claim about a business drawn from a sample of three, and it is not ours to
 * publish. Same data, and only one of the two is defensible once the product is public
 * — so the phrasing lives here, next to the query, rather than being re-invented by
 * each surface that renders it.
 *
 * The three-item minimum is enforced by the view's own HAVING clause, in
 * 0004_wear_and_tear.sql: one bad shirt is a bad shirt, not evidence about a shop.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toRetailerDurability, type RetailerDurabilityRow } from '@/lib/mappers';
import type { RetailerDurability } from '@/types';

const COLUMNS =
  'retailer, items, avg_wears, avg_price, avg_cost_per_wear, avg_condition, avg_wears_to_decline, worn_out_count';

/**
 * Worst-lasting first: the useful reading of this table is "where should I not shop
 * again", and that answer should not be below the fold.
 */
export async function retailerDurability(
  supabase: SupabaseClient,
): Promise<RetailerDurability[]> {
  const { data, error } = await supabase
    .from('retailer_durability')
    .select(COLUMNS)
    .order('avg_wears', { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as RetailerDurabilityRow[]).map(toRetailerDurability);
}

/**
 * One line of plain English about a retailer, in the user's own terms. Decline is only
 * mentioned when some item from that shop has actually declined — inventing a number
 * for a shop whose clothes are all still fine would be the opposite of the point.
 */
export function describeRetailer(row: RetailerDurability): string {
  const wears = `averaged ${formatNumber(row.avgWears)} wear${row.avgWears === 1 ? '' : 's'}`;
  const decline =
    row.avgWearsToDecline === null
      ? null
      : `showing wear at about ${formatNumber(row.avgWearsToDecline)}`;

  return [`Your ${row.items} items from here have ${wears}`, decline]
    .filter(Boolean)
    .join(', ')
    .concat('.');
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
