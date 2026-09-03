/**
 * GET  /api/categories   the nine system categories plus the caller's own
 * POST /api/categories   create a custom one — module 16 §4, §7.1
 *
 * §7.1 is the reason this route exists at all. The prototype had nine fixed categories
 * *and* an "Add Custom Category" button; the spec had a six-value Postgres enum, because
 * beam search needs fixed slots to assemble against. Both were right about different
 * things, so the concept was split: `slot` stays an internal enum the engine works on,
 * and `category_id` is a row in this table — displayed, filterable and user-extensible.
 *
 * A custom category therefore has to name its slot. `Activewear` is the case that proves
 * one cannot be derived from the other: a workout top is slot `top`, yoga pants are slot
 * `bottom`, and both are category Activewear.
 *
 * System rows have `user_id is null` and are visible to everyone; RLS lets a user write
 * only rows that are theirs, so "delete the default Tops category" is refused by the
 * database rather than by a check here.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { toCategory, type CategoryRow } from '@/lib/mappers';
import { SLOTS } from '@/app/api/items/schemas';

export const dynamic = 'force-dynamic';

export const CATEGORY_COLUMNS =
  'id, user_id, name, slug, icon, default_slot, subtypes, outfit_eligible, sort_order';

export const categoryBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** Which slot items filed here default to — the engine's axis, not the display one. */
  defaultSlot: z.enum(SLOTS),
  /** Emoji, as the prototype uses. One or two characters; not validated as an emoji. */
  icon: z.string().trim().max(4).nullish(),
  subtypes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** False keeps items browsable and countable but never assembled (§7.1). */
  outfitEligible: z.boolean().optional(),
});

/** "Ethnic Wear" → "ethnic-wear". Unique per user, enforced by a partial index. */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export const GET = handle(async () => {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_COLUMNS)
    .order('sort_order');
  if (error) throw error;

  return ok({ categories: ((data ?? []) as unknown as CategoryRow[]).map(toCategory) });
});

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const body = await parseBody(request, categoryBodySchema);
  const supabase = await createClient();

  const slug = slugify(body.name);
  if (!slug) {
    throw appError('VALIDATION_FAILED', undefined, { name: 'Give it a name with letters in it.' });
  }

  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id: user.id,
      name: body.name,
      slug,
      icon: body.icon ?? null,
      default_slot: body.defaultSlot,
      subtypes: body.subtypes ?? [],
      outfit_eligible: body.outfitEligible ?? true,
      // After the nine seeded rows (10..90), so a custom category sorts to the bottom
      // rather than into the middle of a list the user already knows the order of.
      sort_order: 200,
    })
    .select(CATEGORY_COLUMNS)
    .single();

  // The unique index on (user_id, slug) is what makes a duplicate name a 409 rather
  // than two categories that look identical in the sidebar.
  if (error?.code === '23505') {
    throw appError('VALIDATION_FAILED', undefined, { name: 'You already have one of those.' });
  }
  if (error) throw error;

  return ok({ category: toCategory(data as unknown as CategoryRow) }, { status: 201 });
});
