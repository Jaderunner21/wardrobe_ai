/**
 * GET /api/bin — what is in the Bin, and how long it has (module 16 §4).
 *
 * The 30 days is returned rather than hardcoded in the UI: a bin with no stated
 * expiry is a storage leak the user cannot see, and the number the screen prints
 * should come from the same place the purge job reads.
 */
import { handle, ok } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { BIN_PURGE_DAYS, ITEM_DETAIL_SELECT } from '@/lib/items';
import { toItem, type ItemRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('items')
    .select(ITEM_DETAIL_SELECT)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;

  return ok({
    items: ((data ?? []) as unknown as ItemRow[]).map(toItem),
    purgesAfterDays: BIN_PURGE_DAYS,
  });
});
