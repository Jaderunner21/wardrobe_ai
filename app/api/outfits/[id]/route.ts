/**
 * PATCH  /api/outfits/[id] — keep it, plan it for a date, or reword it
 * DELETE /api/outfits/[id]
 *
 * Planning stores an intent for a date. It does not forecast: when the date arrives the
 * outfit is shown as planned, not re-scored against that day's weather (module 09 §4).
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { OUTFIT_SELECT, toOutfitWithItems, type OutfitEmbeddedRow } from '@/lib/outfits';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    saved: z.boolean().optional(),
    plannedFor: z.string().date().nullish(),
    rationale: z.string().max(1000).nullish(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

export const PATCH = handle(async (request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const patch = await parseBody(request, patchSchema);
  const supabase = await createClient();

  const row: Record<string, unknown> = {};
  if (patch.saved !== undefined) row.saved = patch.saved;
  if (patch.plannedFor !== undefined) row.planned_for = patch.plannedFor ?? null;
  if (patch.rationale !== undefined) row.rationale = patch.rationale ?? null;

  const { data, error } = await supabase
    .from('outfits')
    .update(row)
    .eq('id', id)
    .select(OUTFIT_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw appError('NOT_FOUND');

  return ok({ outfit: toOutfitWithItems(data as unknown as OutfitEmbeddedRow) });
});

export const DELETE = handle(async (_request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const supabase = await createClient();

  // outfit_items cascades. The items themselves are untouched — deleting an outfit is
  // forgetting a combination, not throwing away clothes.
  const { error } = await supabase.from('outfits').delete().eq('id', id);
  if (error) throw error;

  return new Response(null, { status: 204 });
});
