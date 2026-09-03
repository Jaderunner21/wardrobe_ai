/**
 * POST /api/outfits — persist an outfit (module 09 §1)
 * GET  /api/outfits — saved outfits, or a date range for the planner
 *
 * One endpoint for both ways an outfit is created: saving a recommendation, and
 * building one by hand. Two paths would drift, and the difference is one enum value.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import {
  listOutfits,
  OUTFIT_SELECT,
  toOutfitWithItems,
  type OutfitEmbeddedRow,
} from '@/lib/outfits';
import { SEASONS, SLOTS, STYLES } from '@/app/api/items/schemas';
import { track } from '@/lib/events';

export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    // Parallel arrays, as api-contracts.md specifies.
    itemIds: z.array(z.string().uuid()).min(2).max(5),
    slots: z.array(z.enum(SLOTS)).min(2).max(5),
    style: z.enum(STYLES).nullish(),
    season: z.enum(SEASONS).nullish(),
    tempBucket: z.number().int().min(0).max(4).nullish(),
    source: z.enum(['rules', 'llm', 'manual']),
    score: z.number().min(0).max(1).nullish(),
    rationale: z.string().max(1000).nullish(),
    saved: z.boolean().optional(),
    plannedFor: z.string().date().nullish(),
  })
  .refine((b) => b.itemIds.length === b.slots.length, {
    message: 'itemIds and slots must line up.',
    path: ['slots'],
  })
  .refine((b) => new Set(b.slots).size === b.slots.length, {
    // No outfit has two bottoms.
    message: 'Each slot may appear once.',
    path: ['slots'],
  })
  .refine((b) => new Set(b.itemIds).size === b.itemIds.length, {
    message: 'Each item may appear once.',
    path: ['itemIds'],
  });

const listQuerySchema = z.object({
  saved: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const GET = handle(async (request: Request) => {
  await requireUser();
  const supabase = await createClient();

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw appError('VALIDATION_FAILED');

  return ok({ outfits: await listOutfits(supabase, parsed.data) });
});

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const body = await parseBody(request, createSchema);
  const supabase = await createClient();

  // RLS already scopes this to the caller, so a short count means an id that is not
  // theirs or an item that is not ready — either way the outfit is not creatable.
  const { data: owned, error: itemsError } = await supabase
    .from('items')
    .select('id')
    .in('id', body.itemIds)
    .eq('status', 'ready')
    .is('deleted_at', null);
  if (itemsError) throw itemsError;

  if ((owned?.length ?? 0) !== body.itemIds.length) {
    throw appError('VALIDATION_FAILED', 'Those items are not all available.', {
      itemIds: 'Every item must be one of yours and ready to wear.',
    });
  }

  const { data: outfit, error: outfitError } = await supabase
    .from('outfits')
    .insert({
      user_id: user.id,
      source: body.source,
      style: body.style ?? null,
      season: body.season ?? null,
      temp_bucket: body.tempBucket ?? null,
      score: body.score ?? null,
      rationale: body.rationale ?? null,
      // Every recommendation the user acts on gets a row so feedback has something
      // stable to point at; `saved` is what separates "kept" from "was shown".
      saved: body.saved ?? false,
      planned_for: body.plannedFor ?? null,
    })
    .select('id')
    .single();
  if (outfitError) throw outfitError;

  const { error: linkError } = await supabase.from('outfit_items').insert(
    body.itemIds.map((itemId, index) => ({
      outfit_id: outfit.id,
      item_id: itemId,
      slot: body.slots[index],
    })),
  );

  if (linkError) {
    // An outfit with no items is worse than no outfit: it renders as an empty card
    // and there is no way for the user to repair it.
    await supabase.from('outfits').delete().eq('id', outfit.id);
    throw linkError;
  }

  const { data: created, error: readError } = await supabase
    .from('outfits')
    .select(OUTFIT_SELECT)
    .eq('id', outfit.id)
    .single();
  if (readError) throw readError;

  /**
   * Module 19 §7 compares the two engines on three numbers, and this is one of them.
   * `source` is what makes it answerable: a saved-outfit rate with no engine attached
   * measures nothing about the swap.
   */
  const saved = toOutfitWithItems(created as unknown as OutfitEmbeddedRow);
  await track('outfit_saved', { outfitId: saved.id, source: body.source });

  return ok({ outfit: saved }, { status: 201 });
});
