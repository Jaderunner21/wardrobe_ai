/**
 * Request shapes for every /api/items route (module 05, api-contracts.md).
 *
 * Zod at the trust boundary, types inferred from the schema rather than declared
 * twice (module 01 — Validation). Not a route file: App Router only treats
 * `route.ts` / `page.tsx` as routes, so this sits beside them.
 */
import { z } from 'zod';

export const SLOTS = ['top', 'bottom', 'fullbody', 'outerwear', 'footwear', 'accessory'] as const;
export const STYLES = [
  'lounge',
  'workout',
  'casual',
  'date-night',
  'party',
  'business',
  'formal',
] as const;
export const SEASONS = ['summer', 'monsoon', 'winter', 'all'] as const;
export const PATTERNS = ['solid', 'striped', 'checked', 'printed', 'textured'] as const;
export const SORTS = ['recent', 'least-worn', 'recently-worn', 'cost-per-wear'] as const;

/** Why an item left the wardrobe — module 18 §5. Always skippable, never inferred. */
export const RETIRED_REASONS = [
  'worn_out',
  'no_longer_fits',
  'disliked',
  'sold',
  'donated',
  'lost',
  'other',
] as const;

/**
 * Formality and warmth are 1..5 unions in `types/index.ts`, not plain numbers, so the
 * schema has to produce the union too — otherwise every consumer needs a cast, and a
 * cast is where a 7 gets through.
 */
const oneToFive = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/** Attributes a person (or, later, the tagger) fills in. All optional everywhere. */
const attributes = {
  name: z.string().trim().min(1).max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  categoryId: z.string().uuid().nullish(),
  slot: z.enum(SLOTS).nullish(),
  style: z.enum(STYLES).nullish(),
  /**
   * An empty brand is null, never the string "unknown" — module 16 §4 caught the
   * prototype filing "unknown" as a brand, where it sorts and filters like one.
   */
  brand: z.string().trim().min(1).max(80).nullish(),
  subtype: z.string().trim().max(80).nullish(),
  primaryColor: z.string().trim().max(40).nullish(),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb.')
    .nullish(),
  secondaryColors: z.array(z.string().trim().max(40)).max(5).optional(),
  pattern: z.enum(PATTERNS).nullish(),
  material: z.string().trim().max(60).nullish(),
  formality: oneToFive.nullish(),
  warmth: oneToFive.nullish(),
  seasons: z.array(z.enum(SEASONS)).max(4).optional(),
  userTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
};

/** Purchase history — USER-ENTERED ONLY. Tagging never touches these (module 17 §3). */
const purchase = {
  price: z.number().nonnegative().max(10_000_000).nullish(),
  currency: z.string().length(3).nullish(),
  purchasedOn: z.string().date().nullish(),
  retailer: z.string().trim().max(80).nullish(),
  cpwTarget: z.number().positive().nullish(),
};

export const createItemSchema = z.object({
  itemId: z.string().uuid(),
  storagePath: z.string().min(1),
  thumbPath: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  ...attributes,
  ...purchase,
});

export const patchItemSchema = z
  .object({
    ...attributes,
    ...purchase,
    favourite: z.boolean().optional(),
    archived: z.boolean().optional(),
    lastWornOn: z.string().date().nullish(),
    /**
     * The wear count is the user's number — module 18 §3b. Written through
     * `set_wear_count()`, never as a plain column update, so the estimated part lands
     * in `initial_wear_count` and a measured 40 stays distinguishable from a guessed
     * one. The database rejects a negative count too; this is the friendlier refusal.
     */
    wearCount: z.number().int().min(0).max(100_000).optional(),
    /** Module 18 §5. Set when an item is binned or archived; skipping leaves it null. */
    retiredReason: z.enum(RETIRED_REASONS).nullish(),
    /** The upload screen flips draft → ready; nothing else may set a status. */
    status: z.enum(['draft', 'ready']).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update.' });

/**
 * POST /api/items/[id]/condition — module 18 §1. Five levels, user-rated only, and the
 * only writer is `rate_condition()` so the log row and the item can never drift.
 */
export const rateConditionSchema = z.object({
  condition: oneToFive,
  note: z.string().trim().max(500).nullish(),
});

/**
 * POST /api/items/[id]/wore — an optional past date, for a wearing the user forgot to
 * log. A future date is refused by `log_wear()`.
 */
export const woreSchema = z.object({ wornOn: z.string().date().optional() });

export const itemIdsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(50),
});

/** GET /api/items — parsed from the query string, so everything arrives as text. */
export const listQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  style: z.enum(STYLES).optional(),
  season: z.enum(SEASONS).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  favourite: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  /** Module 18 §6's wardrobe filter: condition <= 2. */
  needsReplacing: z.coerce.boolean().optional(),
  sort: z.enum(SORTS).default('recent'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type RateConditionBody = z.infer<typeof rateConditionSchema>;
export type CreateItemBody = z.infer<typeof createItemSchema>;
export type PatchItemBody = z.infer<typeof patchItemSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
