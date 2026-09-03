/**
 * POST /api/items/tag — module 06 §3.
 *
 * The order is the whole module:
 *
 *   1. load the item; if already `tagging`, return early (concurrent call)
 *   2. assertBudget — BEFORE the model call
 *   3. status → 'tagging'
 *   4. short-lived signed URL; the bucket is private
 *   5. callModel with retries
 *   6. Zod-parse; a parse failure is a model failure
 *   7. resolve categorySlug → the user's category, write attributes + ai_raw
 *   8. recordUsage — AFTER the call
 *   9. the wardrobe_version bump happens by trigger on the update
 *
 * Budget before, usage after. A crash between them costs one call; the reverse order
 * would bill for the call it was meant to prevent.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError, toAppError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { assertBudget, recordUsage } from '@/lib/budget';
import { MODEL, tagGarment } from '@/lib/gemini';
import { signedUrl } from '@/lib/storage';
import { ITEM_DETAIL_SELECT } from '@/lib/items';
import { toItem, type ItemRow } from '@/lib/mappers';
import type { Slot, TagResult } from '@/types';
import { track } from '@/lib/events';

export const dynamic = 'force-dynamic';

/** Long enough for the fetch, short enough that a leaked URL is worthless. */
const IMAGE_URL_TTL_SECONDS = 300;

const bodySchema = z.object({ itemId: z.string().uuid() });

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { itemId } = await parseBody(request, bodySchema);
  const supabase = await createClient();

  // 1
  const { data: existing, error: readError } = await supabase
    .from('items')
    .select(ITEM_DETAIL_SELECT)
    .eq('id', itemId)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) throw appError('NOT_FOUND');

  const item = toItem(existing as unknown as ItemRow);

  // A second call while the first is in flight is a no-op, not a second bill.
  if (item.status === 'tagging') return ok({ item });

  // 2 — throws AI_BUDGET_EXCEEDED or PREMIUM_REQUIRED before any network call.
  await assertBudget(user.id, 'tag');

  // 3
  await supabase.from('items').update({ status: 'tagging', ai_error: null }).eq('id', itemId);

  try {
    // 4
    const url = await signedUrl(item.storagePath, IMAGE_URL_TTL_SECONDS);

    // The model picks from the user's own categories rather than inventing one.
    const { data: categoryRows } = await supabase
      .from('categories')
      .select('id, slug, default_slot, user_id')
      .order('sort_order');
    const categories = (categoryRows ?? []) as unknown as {
      id: string;
      slug: string;
      default_slot: Slot;
      user_id: string | null;
    }[];

    // 5, 6
    const result = await tagGarment(
      url,
      categories.map((c) => c.slug),
    );
    const tag: TagResult = result.data;

    // 7 — an unrecognised slug falls back to the system category for that slot, so a
    // hallucinated category name never leaves the item uncategorised.
    const matched =
      categories.find((c) => c.slug === tag.categorySlug) ??
      categories.find((c) => c.user_id === null && c.default_slot === tag.slot);

    const { data: updated, error: writeError } = await supabase
      .from('items')
      .update({
        status: 'draft', // Review & Edit, not the wardrobe. Save All is what promotes it.
        name: tag.name ?? null,
        category_id: matched?.id ?? null,
        slot: tag.slot,
        style: tag.style,
        subtype: tag.subtype,
        primary_color: tag.primaryColor,
        color_hex: tag.colorHex,
        secondary_colors: tag.secondaryColors,
        pattern: tag.pattern,
        material: tag.material,
        formality: tag.formality,
        warmth: tag.warmth,
        seasons: tag.seasons,
        ai_confidence: tag.confidence,
        ai_model: MODEL,
        ai_raw: result.raw,
        ai_error: null,
      })
      .eq('id', itemId)
      .select(ITEM_DETAIL_SELECT)
      .single();
    if (writeError) throw writeError;

    // 8
    await recordUsage(user.id, 'tag', result.inTokens, result.outTokens);

    /**
     * The denominator for module 14 §1's correction rate. Confidence rides along
     * because "which confidence band gets corrected most" is the follow-up question the
     * moment the headline number is not what you hoped.
     */
    await track('item_tagged', { itemId, confidence: tag.confidence, model: MODEL });

    return ok({ item: toItem(updated as unknown as ItemRow) });
  } catch (e) {
    // 4 — module 06 §4. The item stays fully usable and editable; the client shows a
    // retry. No queue in the test phase: with 15 users you hear about failures
    // directly, which is better signal than a queue draining silently.
    const failure = toAppError(e);
    await supabase
      .from('items')
      .update({ status: 'failed', ai_error: failure.message })
      .eq('id', itemId);

    throw failure.code === 'INTERNAL' ? appError('AI_UNAVAILABLE') : failure;
  }
});
