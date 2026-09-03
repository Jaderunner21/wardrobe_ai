/**
 * POST /api/items/[id]/condition — module 18 §1, §2.
 *
 * The whole write goes through `rate_condition()`: it appends the immutable log row AND
 * updates the item's current condition in one function, so the history and the field
 * can never disagree. Nothing here writes `items.condition` directly, and nothing
 * anywhere updates or deletes a log row — the series is the feature (§2).
 *
 * No analytics event is emitted. Module 18's acceptance list is explicit: no condition
 * or retailer data in `events`.
 */
import { handle, ok, parseBody } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { toItem, type ItemRow } from '@/lib/mappers';
import { rateConditionSchema } from '../../schemas';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const body = await parseBody(request, rateConditionSchema);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('rate_condition', {
    p_item_id: id,
    p_condition: body.condition,
    p_note: body.note ?? null,
  });

  // The function raises NOT_FOUND for an item that is not the caller's — RLS inside it
  // is what makes that the same answer as "does not exist" — and `lib/errors.ts`
  // already turns that raise into a 404.
  if (error) throw error;

  return ok({ item: toItem(data as unknown as ItemRow) });
});
