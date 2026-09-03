/**
 * Request shapes for /api/categories — module 16 §4, §7.1.
 *
 * Not in `route.ts`: the App Router treats every export from a route file as a handler
 * and fails the build on anything else, so shared constants and schemas sit beside it —
 * the same arrangement `app/api/items/schemas.ts` uses.
 */
import { z } from 'zod';
import { SLOTS } from '@/app/api/items/schemas';

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
