/**
 * Outfit reads — module 09 §6.
 *
 * One query with an embedded join, never N+1. The calendar is the case that forces it:
 * a month of planned outfits is up to 31 outfits × 4 items, and fetching those
 * separately is 124 round trips to render one screen.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ITEM_LIST_SELECT } from '@/lib/items';
import { toItemListView, type ItemListRow, type ItemListView, type OutfitRow } from '@/lib/mappers';
import type { Outfit, Slot } from '@/types';

const OUTFIT_COLUMNS =
  'id, user_id, source, style, season, temp_bucket, score, rationale, saved, planned_for, created_at';

/** Items come back hydrated with the list columns, which is all any outfit view shows. */
export const OUTFIT_SELECT = `${OUTFIT_COLUMNS}, outfit_items(item_id, slot, items(${ITEM_LIST_SELECT}))`;

export interface OutfitWithItems extends Omit<Outfit, 'items'> {
  items: { itemId: string; slot: Slot; item: ItemListView | null }[];
}

export interface OutfitEmbeddedRow extends OutfitRow {
  outfit_items: { item_id: string; slot: Slot; items: ItemListRow | null }[] | null;
}

export function toOutfitWithItems(row: OutfitEmbeddedRow): OutfitWithItems {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    style: row.style,
    season: row.season,
    tempBucket: row.temp_bucket,
    score: row.score,
    rationale: row.rationale,
    saved: row.saved,
    plannedFor: row.planned_for,
    createdAt: row.created_at,
    items: (row.outfit_items ?? []).map((oi) => ({
      itemId: oi.item_id,
      slot: oi.slot,
      // An outfit containing an archived item still loads (module 09 §2). People do
      // wear things they later stop owning, and breaking their saved outfits to
      // enforce tidiness is worse than the inconsistency.
      item: oi.items ? toItemListView(oi.items) : null,
    })),
  };
}

export interface OutfitQuery {
  saved?: boolean;
  /** Inclusive ISO dates, for the planner's month. */
  from?: string;
  to?: string;
}

export async function listOutfits(
  supabase: SupabaseClient,
  params: OutfitQuery = {},
): Promise<OutfitWithItems[]> {
  let query = supabase.from('outfits').select(OUTFIT_SELECT);

  if (params.saved !== undefined) query = query.eq('saved', params.saved);
  if (params.from) query = query.gte('planned_for', params.from);
  if (params.to) query = query.lte('planned_for', params.to);
  if (params.from || params.to) query = query.not('planned_for', 'is', null);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
  if (error) throw error;

  return ((data ?? []) as unknown as OutfitEmbeddedRow[]).map(toOutfitWithItems);
}

/** Every stored thumbnail path in a set of outfits, for one batch of signed URLs. */
export const thumbPathsOf = (outfits: OutfitWithItems[]): string[] =>
  outfits.flatMap((o) => o.items.map((i) => i.item?.thumbPath).filter((p): p is string => !!p));
