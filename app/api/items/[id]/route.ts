/**
 * GET    /api/items/[id]                  full row
 * PATCH  /api/items/[id]                  any user-editable field (module 05 §4)
 * DELETE /api/items/[id]                  → the Bin
 * DELETE /api/items/[id]?permanent=true   → row and both stored images, irreversible
 * DELETE /api/items/[id]?reason=worn_out  → records why it left (module 18 §5)
 *
 * Ownership is enforced by RLS, not by application code: a query for another user's
 * item returns zero rows, which becomes a 404. No manual `where user_id` here — the
 * check would be redundant, and redundancy is where the real check gets forgotten.
 */
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { ITEM_DETAIL_SELECT } from '@/lib/items';
import { toItem, toItemRow, type ItemRow } from '@/lib/mappers';
import { correctedFields, track, trackCorrections } from '@/lib/events';
import { deleteObjects } from '@/lib/storage';
import { patchItemSchema, RETIRED_REASONS } from '../schemas';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('items')
    .select(ITEM_DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw appError('NOT_FOUND');

  return ok({ item: toItem(data as unknown as ItemRow) });
});

export const PATCH = handle(async (request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const patch = await parseBody(request, patchItemSchema);
  const supabase = await createClient();

  const { data: before, error: readError } = await supabase
    .from('items')
    .select(ITEM_DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!before) throw appError('NOT_FOUND');

  const current = toItem(before as unknown as ItemRow);

  // The correction stream, module 05 §4: one event per changed AI field, with the old
  // and the new value. That stream is the correction rate — the single most useful
  // number in the test phase — and it costs one line here.
  const corrections = correctedFields(current, patch);

  /**
   * The wear count goes through `set_wear_count()` rather than the column — module 18
   * §3b. That function keeps the estimated part in `initial_wear_count`, so a measured
   * 40 stays distinguishable from a guessed 40 and `wear_confidence()` stays honest.
   * Writing `wear_count` directly here would quietly destroy that distinction.
   */
  if (patch.wearCount !== undefined && patch.wearCount !== current.wearCount) {
    const { error } = await supabase.rpc('set_wear_count', {
      p_item_id: id,
      p_count: patch.wearCount,
    });
    if (error) throw error;
  }

  const row = toItemRow(patch);
  if (patch.lastWornOn !== undefined) row.last_worn_on = patch.lastWornOn ?? null;
  if (corrections.length > 0) row.user_edited = true;

  // "When it was retired" is ours to stamp, not the client's to assert.
  if (patch.retiredReason !== undefined) {
    row.retired_at = patch.retiredReason ? new Date().toISOString() : null;
  }

  const { data, error } = Object.keys(row).length > 0
    ? await supabase.from('items').update(row).eq('id', id).select(ITEM_DETAIL_SELECT).single()
    : await supabase.from('items').select(ITEM_DETAIL_SELECT).eq('id', id).single();
  if (error) throw error;

  await trackCorrections(id, corrections);
  if (patch.archived === true && !current.archived) await track('item.archived', { itemId: id });

  return ok({ item: toItem(data as unknown as ItemRow) });
});

export const DELETE = handle(async (request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const permanent = params.get('permanent') === 'true';

  /**
   * Why it left — module 18 §5. One tap, skippable, so an absent or unrecognised
   * reason is simply no reason rather than a validation error: refusing the delete
   * because the reason did not parse would be the wrong trade on the button whose
   * whole job is to remove the item.
   */
  const raw = params.get('reason');
  const reason = RETIRED_REASONS.find((r) => r === raw) ?? null;
  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from('items')
    .select('id, storage_path, thumb_path')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) throw appError('NOT_FOUND');

  if (!permanent) {
    // The Bin. Storage is untouched: the item leaves the wardrobe, stops counting
    // toward the quota and stops being recommendable, but is restorable for 30 days.
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('items')
      .update({
        deleted_at: now,
        ...(reason ? { retired_reason: reason, retired_at: now } : {}),
      })
      .eq('id', id);
    if (error) throw error;

    // The reason is deliberately NOT in the event: module 18's acceptance list says no
    // condition or retailer data in analytics, and `worn_out` is durability data.
    await track('item.deleted', { itemId: id, permanent: false });
    return new Response(null, { status: 204 });
  }

  const paths = [existing.storage_path, existing.thumb_path].filter(Boolean) as string[];

  // Images first, then the row — but never leave a row pointing at nothing. If the
  // storage delete fails the row still goes and the orphan is logged; an orphaned
  // object costs quota, an orphaned row renders a permanently broken card.
  try {
    await deleteObjects(paths);
  } catch (e) {
    console.error('[storage] orphaned objects after permanent delete', { itemId: id, paths, e });
  }

  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;

  await track('item.deleted', { itemId: id, permanent: true });
  return new Response(null, { status: 204 });
});
