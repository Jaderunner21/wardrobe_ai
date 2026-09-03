/**
 * Style Insights — module 16 §4's right rail.
 *
 * Two numbers, both derived from rows the dashboard already needs. Nothing is stored:
 * an insight that can go stale is worse than one computed on the spot, and at wardrobe
 * scale (tens of items, not thousands) this costs nothing.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Insights {
  /** Category id the user actually wears most, by total wears rather than item count. */
  mostWornCategoryId: string | null;
  mostWornWears: number;
  /** How much of the wardrobe's breadth is in use: categories worn / categories owned. */
  diversityPercent: number;
  categoriesOwned: number;
  neverWorn: number;
}

export async function styleInsights(supabase: SupabaseClient): Promise<Insights> {
  const { data, error } = await supabase
    .from('items')
    .select('category_id, wear_count')
    .eq('status', 'ready')
    .eq('archived', false)
    .is('deleted_at', null);
  if (error) throw error;

  const rows = (data ?? []) as unknown as { category_id: string | null; wear_count: number }[];

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

  return {
    mostWornCategoryId,
    mostWornWears,
    // Nothing owned is 0%, not a division by zero.
    diversityPercent: owned.size === 0 ? 0 : Math.round((wornCategories / owned.size) * 100),
    categoriesOwned: owned.size,
    neverWorn,
  };
}
