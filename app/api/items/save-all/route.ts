/**
 * POST /api/items/save-all — the prototype's "Save All to Wardrobe (N)" button
 * (module 04 §5b). Flips a batch of the caller's drafts to `ready` in one request.
 *
 * All-or-nothing. A partial save leaves the user unsure what happened, which on the
 * screen where their whole upload lives is the worst possible outcome.
 */
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { ITEM_DETAIL_SELECT } from '@/lib/items';
import { toItem, type ItemRow } from '@/lib/mappers';
import { track } from '@/lib/events';
import { itemIdsSchema } from '../schemas';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request) => {
  await requireUser();
  const { itemIds } = await parseBody(request, itemIdsSchema);
  const supabase = await createClient();

  // RLS means this only ever returns the caller's rows, so a short count is either a
  // wrong id or an item that is no longer a draft. Either way: refuse the whole batch.
  const { data: drafts, error: readError } = await supabase
    .from('items')
    .select('id')
    .in('id', itemIds)
    .eq('status', 'draft')
    .is('deleted_at', null);
  if (readError) throw readError;

  if ((drafts?.length ?? 0) !== itemIds.length) {
    throw appError('VALIDATION_FAILED', 'Some of those items are no longer drafts.', {
      itemIds: 'Every id must be a draft you own.',
    });
  }

  const { data, error } = await supabase
    .from('items')
    .update({ status: 'ready' })
    .in('id', itemIds)
    .select(ITEM_DETAIL_SELECT);
  if (error) throw error;

  const items = ((data ?? []) as unknown as ItemRow[]).map(toItem);
  await track('item.saved', { count: items.length });

  return ok({ saved: items.length, items });
});
