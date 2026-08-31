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
    /** The upload screen flips draft → ready; nothing else may set a status. */
    status: z.enum(['draft', 'ready']).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update.' });

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
  sort: z.enum(SORTS).default('recent'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateItemBody = z.infer<typeof createItemSchema>;
export type PatchItemBody = z.infer<typeof patchItemSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
