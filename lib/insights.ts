/**
 * Style Insights — module 16 §4's right rail.
 *
 * Two numbers, both derived from rows the dashboard already needs. Nothing is stored:
 * an insight that can go stale is worse than one computed on the spot, and at wardrobe
 * scale (tens of items, not thousands) this costs nothing.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isStale } from '@/lib/cpw';

export interface Insights {
  /** Category id the user actually wears most, by total wears rather than item count. */
  mostWornCategoryId: string | null;
  mostWornWears: number;
  /** How much of the wardrobe's breadth is in use: categories worn / categories owned. */
  diversityPercent: number;
  categoriesOwned: number;
  neverWorn: number;
  /**
   * Module 17 §5: cost-per-wear is what gives this panel something worth looking at.
   * Most Worn Category and Wardrobe Diversity are weak numbers on their own.
   */
  bestValue: { id: string; name: string | null; costPerWear: number } | null;
  /** A fact the user can act on, never a verdict on the purchase. */
  staleCount: number;
}

export async function styleInsights(supabase: SupabaseClient): Promise<Insights> {
  const { data, error } = await supabase
    .from('items')
    .select('id, name, category_id, wear_count, price, cost_per_wear, last_worn_on, created_at')
    .eq('status', 'ready')
    .eq('archived', false)
    .is('deleted_at', null);
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string | null;
    category_id: string | null;
    wear_count: number;
    price: number | null;
    cost_per_wear: number | null;
    last_worn_on: string | null;
    created_at: string;
  }[];

  const wearsByCategory = new Map<string, number>();
  const owned = new Set<string>();
  let neverWorn = 0;

  for (const row of rows) {
    if (row.wear_count === 0) neverWorn += 1;
    if (!row.category_id) continue;
    owned.add(row.category_id);
    wearsByCategory.set(row.category_id, (wearsByCategory.get(row.category_id) ?? 0) + row.wear_count);
  }

  let mostWornCategoryId: string | null = null;
  let mostWornWears = 0;
  for (const [id, wears] of wearsByCategory) {
    if (wears > mostWornWears) {
      mostWornCategoryId = id;
      mostWornWears = wears;
    }
  }

  const wornCategories = [...wearsByCategory.values()].filter((w) => w > 0).length;

  // Best value is the lowest cost per wear among items that have both a price and a
  // wear — an unworn item's CPW is its full price, which is honest but not an insight.
  let bestValue: Insights['bestValue'] = null;
  let staleCount = 0;

  for (const row of rows) {
    if (isStale({ lastWornOn: row.last_worn_on, createdAt: row.created_at, wearCount: row.wear_count })) {
      staleCount += 1;
    }

    if (row.price === null || row.wear_count === 0) continue;
    const cpw = row.cost_per_wear ?? row.price / row.wear_count;
    if (bestValue === null || cpw < bestValue.costPerWear) {
      bestValue = { id: row.id, name: row.name, costPerWear: Number(cpw) };
    }
  }

  return {
    mostWornCategoryId,
    mostWornWears,
    // Nothing owned is 0%, not a division by zero.
    diversityPercent: owned.size === 0 ? 0 : Math.round((wornCategories / owned.size) * 100),
    categoriesOwned: owned.size,
    neverWorn,
    bestValue,
    staleCount,
  };
}
