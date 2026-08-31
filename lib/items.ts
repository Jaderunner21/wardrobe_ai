/**
 * Wardrobe queries — module 05 §3.
 *
 * One place that knows how to filter, sort and page the wardrobe, shared by the
 * Server Component that renders the grid and by `GET /api/items` which serves filter
 * changes and later pages. Two implementations of "which items are visible" would
 * drift, and the one that drifts is the one that leaks drafts into the wardrobe.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ITEM_LIST_COLUMNS } from '@/types';
import { toItemListView, type ItemListRow, type ItemListView } from '@/lib/mappers';
import type { ListQuery } from '@/app/api/items/schemas';

/** Never `select('*')` — `ITEM_LIST_COLUMNS` is the allowed list for grids (module 02 §3). */
export const ITEM_LIST_SELECT = ITEM_LIST_COLUMNS.join(', ');

/**
 * How long the Bin holds an item before it and its images are purged. Matches the
 * `purge-bin` job in 0002_ui_alignment.sql §6 — the screen and the job must not be
 * able to disagree about the number the user was promised.
 */
export const BIN_PURGE_DAYS = 30;

/** The detail view is the only place allowed to pull the full row. */
export const ITEM_DETAIL_SELECT =
  'id, user_id, status, storage_path, thumb_path, bytes, width, height, content_hash, name, notes, category_id, slot, style, brand, subtype, primary_color, color_hex, secondary_colors, pattern, material, formality, warmth, seasons, ai_confidence, ai_model, user_edited, user_tags, favourite, wear_count, last_worn_on, archived, deleted_at, created_at, price, currency, purchased_on, retailer, cpw_target, cost_per_wear, initial_wear_count, condition, condition_rated_at, condition_at_wear, retired_reason, retired_at';

type SortSpec = { column: string; ascending: boolean };

const SORTS: Record<ListQuery['sort'], SortSpec> = {
  recent: { column: 'created_at', ascending: false },
  'least-worn': { column: 'wear_count', ascending: true },
  'recently-worn': { column: 'last_worn_on', ascending: false },
  'cost-per-wear': { column: 'cost_per_wear', ascending: true },
};

interface Cursor {
  /** The sort column's value on the last row of the previous page. */
  v: string | number | null;
  /** created_at of that row — the tiebreaker, and the whole cursor when sorting by it. */
  c: string;
}

const encodeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decodeCursor = (raw: string): Cursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    return typeof parsed?.c === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

/** PostgREST needs quoting for values that could contain a comma or a dot. */
const literal = (value: string | number) =>
  typeof value === 'number' ? String(value) : `"${value.replace(/"/g, '\\"')}"`;

/**
 * Text that is safe inside a PostgREST `or()` filter. Commas and parentheses are the
 * grammar of that expression, so a search for "shirt, blue" would otherwise parse as
 * two conditions.
 */
const sanitise = (q: string) => q.replace(/[,().*%\\]/g, ' ').trim();

export interface ListResult {
  items: ItemListView[];
  nextCursor: string | null;
}

/**
 * Everything the wardrobe grid shows. RLS scopes rows to the caller, so there is no
 * `user_id` filter here — the check would be redundant, and a redundant check is one
 * more place to forget.
 */
export async function listItems(
  supabase: SupabaseClient,
  params: ListQuery,
): Promise<ListResult> {
  const sort = SORTS[params.sort];

  let query = supabase
    .from('items')
    .select(ITEM_LIST_SELECT)
    // Drafts belong to the upload screen alone; binned items belong to the Bin.
    .eq('status', 'ready')
    .is('deleted_at', null)
    .eq('archived', params.archived ?? false);

  if (params.categoryId) query = query.eq('category_id', params.categoryId);
  if (params.style) query = query.eq('style', params.style);
  if (params.favourite) query = query.eq('favourite', true);

  // An all-season garment is in season in every season.
  if (params.season) {
    query =
      params.season === 'all'
        ? query.contains('seasons', ['all'])
        : query.or(`seasons.cs.{${params.season}},seasons.cs.{all}`);
  }

  if (params.q) {
    const q = sanitise(params.q);
    if (q) {
      query = query.or(
        [
          `name.ilike.*${q}*`,
          `subtype.ilike.*${q}*`,
          `primary_color.ilike.*${q}*`,
          `brand.ilike.*${q}*`,
          `user_tags.cs.{${q}}`,
        ].join(','),
      );
    }
  }

  // Keyset pagination, never offset: offset re-scans every earlier row and shifts
  // under inserts, which shows the user a duplicate on page two.
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;
  if (cursor) {
    if (sort.column === 'created_at') {
      query = query.lt('created_at', cursor.c);
    } else if (cursor.v === null) {
      // Nulls sort last, so a null cursor means we are already inside that tail.
      query = query.is(sort.column, null).lt('created_at', cursor.c);
    } else {
      const comparison = sort.ascending ? 'gt' : 'lt';
      query = query.or(
        `${sort.column}.${comparison}.${literal(cursor.v)},` +
          `and(${sort.column}.eq.${literal(cursor.v)},created_at.lt.${literal(cursor.c)})`,
      );
    }
  }

  query = query.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
  if (sort.column !== 'created_at') query = query.order('created_at', { ascending: false });

  // Ask for one more than requested: its existence is what says "there is a next page".
  const { data, error } = await query.limit(params.limit + 1);
  if (error) throw error;

  const rows = (data ?? []) as unknown as (ItemListRow & {
    created_at?: string;
    last_worn_on?: string | null;
    cost_per_wear?: number | null;
  })[];

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map(toItemListView),
    nextCursor:
      hasMore && last?.created_at
        ? encodeCursor({
            v:
              sort.column === 'created_at'
                ? last.created_at
                : ((last[sort.column as keyof typeof last] as string | number | null) ?? null),
            c: last.created_at,
          })
        : null,
  };
}

/**
 * Sidebar facet counts (module 16 §4: "Counts on every facet row"). One grouped query
 * would be nicer, but PostgREST has no GROUP BY — counting the id column of every
 * ready item is one small round trip and the numbers are what make the sidebar feel
 * like a wardrobe rather than a menu.
 */
export async function facetCounts(supabase: SupabaseClient): Promise<{
  byCategory: Record<string, number>;
  byStyle: Record<string, number>;
  total: number;
  favourites: number;
  archived: number;
}> {
  const { data, error } = await supabase
    .from('items')
    .select('category_id, style, favourite, archived')
    .eq('status', 'ready')
    .is('deleted_at', null);
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    category_id: string | null;
    style: string | null;
    favourite: boolean;
    archived: boolean;
  }[];

  const byCategory: Record<string, number> = {};
  const byStyle: Record<string, number> = {};
  let total = 0;
  let favourites = 0;
  let archived = 0;

  for (const row of rows) {
    if (row.archived) {
      archived += 1;
      continue;
    }
    total += 1;
    if (row.favourite) favourites += 1;
    if (row.category_id) byCategory[row.category_id] = (byCategory[row.category_id] ?? 0) + 1;
    if (row.style) byStyle[row.style] = (byStyle[row.style] ?? 0) + 1;
  }

  return { byCategory, byStyle, total, favourites, archived };
}
