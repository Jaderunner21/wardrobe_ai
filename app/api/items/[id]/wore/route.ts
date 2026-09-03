/**
 * POST   /api/items/[id]/wore   log a wearing — today, or a date the user forgot
 * DELETE /api/items/[id]/wore   undo one — today by default, ?wornOn= for another day
 *
 * Module 18 §3b. Both are thin wrappers over `log_wear()` and `undo_wear()`, which own
 * the arithmetic: logging is idempotent per (item, day) so a double tap on a card
 * counts once, a future date is refused, and undo recalculates `last_worn_on` from the
 * wears that remain rather than guessing at it.
 *
 * `POST /api/feedback {kind:'worn'}` also calls `log_wear` — that path additionally
 * feeds the style profile, which is right for a wear recorded against an outfit. This
 * route is the plain one-garment version, and the undo the card needs.
 */
import { handle, ok } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { toItem, type ItemRow } from '@/lib/mappers';
import { woreSchema } from '../../schemas';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;

  // An empty body is the common case — "wore this today" — so it must not be an error.
  const raw = (await request.text()).trim();
  const parsed = woreSchema.safeParse(raw === '' ? {} : safeJson(raw));
  if (!parsed.success) {
    throw appError('VALIDATION_FAILED', undefined, { wornOn: 'Expected a date like 2026-09-01.' });
  }
  const { wornOn } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('log_wear', {
    p_item_id: id,
    p_worn_on: wornOn ?? null,
  });
  // `lib/errors.ts` already translates the function's own NOT_FOUND and
  // `VALIDATION_FAILED: <reason>` raises, including the refusal of a future date.
  if (error) throw error;

  return ok({ item: toItem(data as unknown as ItemRow) });
});

export const DELETE = handle(async (request: Request, context: Context) => {
  await requireUser();
  const { id } = await context.params;
  const wornOn = new URL(request.url).searchParams.get('wornOn');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('undo_wear', {
    p_item_id: id,
    p_worn_on: wornOn,
  });
  if (error) throw error;

  return ok({ item: toItem(data as unknown as ItemRow) });
});

/** A body that is not JSON should read as a bad request, not a 500. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
