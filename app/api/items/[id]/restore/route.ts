/**
 * POST /api/items/[id]/restore — bring an item back from the Bin.
 *
 * Restoring is an insert as far as the quota is concerned: a binned item does not
 * count, so a free user at the cap must be told before the row comes back rather than
 * after.
 */
import { handle, ok } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { ITEM_DETAIL_SELECT } from '@/lib/items';
import { toItem, type ItemRow } from '@/lib/mappers';
import { track } from '@/lib/events';
import { FREE_ITEM_CAP } from '@/types';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const POST = handle(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from('items')
    .select('id, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) throw appError('NOT_FOUND');
  if (!existing.deleted_at) throw appError('VALIDATION_FAILED', 'That item is not in the bin.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();
  if (profileError) throw profileError;

  if (profile?.plan === 'free') {
    const { count, error } = await supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);
    if (error) throw error;
    if ((count ?? 0) >= FREE_ITEM_CAP) {
      await track('quota.blocked', { at: 'restore', itemId: id });
      throw appError('ITEM_QUOTA_EXCEEDED');
    }
  }

  const { data, error } = await supabase
    .from('items')
    .update({ deleted_at: null })
    .eq('id', id)
    .select(ITEM_DETAIL_SELECT)
    .single();
  if (error) throw error;

  await track('item.restored', { itemId: id });

  return ok({ item: toItem(data as unknown as ItemRow) });
});
