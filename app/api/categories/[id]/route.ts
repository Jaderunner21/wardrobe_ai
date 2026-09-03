/**
 * PATCH  /api/categories/[id]   rename, re-slot, edit subtypes
 * DELETE /api/categories/[id]   remove a custom one
 *
 * Both act only on rows the caller owns — RLS refuses a system row, so "delete the
 * default Tops category" fails at the database rather than on a check here that
 * someone could forget to write. A refused write returns zero rows, which reads as a
 * 404: the same answer as "no such category", which is the right thing to tell someone
 * about a row that is not theirs.
 *
 * Deleting a category does NOT delete its items. `items.category_id` is ON DELETE SET
 * NULL, so the garments survive as uncategorised and can be refiled. The alternative —
 * a cascade — would mean one tap in Settings silently destroying photographs.
 */
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { toCategory, type CategoryRow } from '@/lib/mappers';
import { CATEGORY_COLUMNS, categoryBodySchema, slugify } from '../route';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const patchSchema = categoryBodySchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: 'Nothing to update.' },
);

export const PATCH = handle(async (request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const body = await parseBody(request, patchSchema);
  const supabase = await createClient();

  const row: Record<string, unknown> = {};
  if (body.name !== undefined) {
    row.name = body.name;
    row.slug = slugify(body.name);
  }
  if (body.defaultSlot !== undefined) row.default_slot = body.defaultSlot;
  if (body.icon !== undefined) row.icon = body.icon ?? null;
  if (body.subtypes !== undefined) row.subtypes = body.subtypes;
  if (body.outfitEligible !== undefined) row.outfit_eligible = body.outfitEligible;

  const { data, error } = await supabase
    .from('categories')
    .update(row)
    .eq('id', id)
    .select(CATEGORY_COLUMNS)
    .maybeSingle();
  if (error?.code === '23505') {
    throw appError('VALIDATION_FAILED', undefined, { name: 'You already have one of those.' });
  }
  if (error) throw error;
  if (!data) throw appError('NOT_FOUND');

  return ok({ category: toCategory(data as unknown as CategoryRow) });
});

export const DELETE = handle(async (_request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw appError('NOT_FOUND');

  return new Response(null, { status: 204 });
});
