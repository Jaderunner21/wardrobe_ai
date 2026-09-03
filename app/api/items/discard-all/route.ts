/**
 * POST /api/items/discard-all — the prototype's "Start Over" (module 04 §5b).
 *
 * Bins the batch rather than destroying it. The bytes are already uploaded and the
 * bin purge (0002 §6) collects them with their images after 30 days, so a user who
 * hits Start Over by mistake has not lost twenty photographs.
 */
import { handle, ok, parseBody } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { track } from '@/lib/events';
import { itemIdsSchema } from '../schemas';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request) => {
  await requireUser();
  const { itemIds } = await parseBody(request, itemIdsSchema);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('items')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', itemIds)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;

  const discarded = data?.length ?? 0;
  await track('item_discarded', { count: discarded });

  return ok({ discarded });
});
