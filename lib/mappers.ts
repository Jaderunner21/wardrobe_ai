/**
 * Postgres row <-> application object mapping (module 02 §5).
 *
 * One mapper pair per table, in one place. Field names in `types/index.ts` are
 * camelCase; the columns are snake_case.
 *
 * No runtime case-converter. A generic snakeToCamel is untyped, invisible to grep,
 * and silently mangles storage_path into storagePath on a good day and storagepath
 * on a bad one.
 */
import type {
  Category,
  Condition,
  ConditionLogEntry,
  Feedback,
  FeedbackKind,
  Formality,
  Item,
  ItemStatus,
  Outfit,
  OutfitItem,
  Pattern,
  Plan,
  Profile,
  RecommendationSource,
  RetailerDurability,
  RetiredReason,
  Season,
  Slot,
  Style,
  StyleProfile,
  TempBucket,
  Warmth,
  WeatherContext,
} from '@/types';

// ───────────────────────────────────────────────────────────── row shapes

export interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_key: string | null;
  city: string | null;
  country: string;
  timezone: string;
  plan: Plan;
  plan_renews_at: string | null;
  item_count: number;
  wardrobe_version: number;
  currency: string;
  cpw_target: number;
  onboarding: Record<string, unknown>;
  created_at: string;
}

export interface CategoryRow {
  id: string;
  user_id: string | null;
  name: string;
  slug: string;
  icon: string | null;
  default_slot: Slot;
  subtypes: string[] | null;
  outfit_eligible: boolean;
  sort_order: number;
}

export interface ItemRow {
  id: string;
  user_id: string;
  status: ItemStatus;
  storage_path: string;
  thumb_path: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  content_hash: string | null;
  name: string | null;
  notes: string | null;
  category_id: string | null;
  slot: Slot | null;
  style: Style | null;
  brand: string | null;
  subtype: string | null;
  primary_color: string | null;
  color_hex: string | null;
  secondary_colors: string[] | null;
  pattern: Pattern | null;
  material: string | null;
  formality: Formality | null;
  warmth: Warmth | null;
  seasons: Season[] | null;
  ai_confidence: number | null;
  ai_model: string | null;
  user_edited: boolean;
  user_tags: string[] | null;
  favourite: boolean;
  wear_count: number;
  last_worn_on: string | null;
  archived: boolean;
  deleted_at: string | null;
  created_at: string;
  price: number | null;
  currency: string | null;
  purchased_on: string | null;
  retailer: string | null;
  cpw_target: number | null;
  cost_per_wear: number | null;
  initial_wear_count: number;
  condition: Condition | null;
  condition_rated_at: string | null;
  condition_at_wear: number | null;
  retired_reason: RetiredReason | null;
  retired_at: string | null;
}

/** The subset a list view selects — ITEM_LIST_COLUMNS in `types/index.ts`. */
export type ItemListRow = Pick<
  ItemRow,
  | 'id'
  | 'status'
  | 'thumb_path'
  | 'category_id'
  | 'slot'
  | 'style'
  | 'brand'
  | 'subtype'
  | 'primary_color'
  | 'color_hex'
  | 'formality'
  | 'warmth'
  | 'seasons'
  | 'user_tags'
  | 'favourite'
  | 'archived'
  | 'wear_count'
>;

export type ItemListView = Pick<
  Item,
  | 'id'
  | 'status'
  | 'thumbPath'
  | 'categoryId'
  | 'slot'
  | 'style'
  | 'brand'
  | 'subtype'
  | 'primaryColor'
  | 'colorHex'
  | 'formality'
  | 'warmth'
  | 'seasons'
  | 'userTags'
  | 'favourite'
  | 'archived'
  | 'wearCount'
>;

export interface StyleProfileRow {
  user_id: string;
  color_affinity: Record<string, number>;
  category_affinity: Record<string, number>;
  formality_bias: number;
  novelty_bias: number;
  rejected_pairs: [string, string][];
  sample_count: number;
  updated_at: string;
}

export interface OutfitRow {
  id: string;
  user_id: string;
  source: RecommendationSource;
  style: Style | null;
  season: Season | null;
  temp_bucket: TempBucket | null;
  score: number | null;
  rationale: string | null;
  saved: boolean;
  planned_for: string | null;
  created_at: string;
}

export interface OutfitItemRow {
  outfit_id: string;
  item_id: string;
  slot: Slot;
}

export interface FeedbackRow {
  id: number;
  user_id: string;
  outfit_id: string | null;
  item_id: string | null;
  kind: FeedbackKind;
  worn_on: string | null;
  created_at: string;
}

export interface ConditionLogRow {
  id: number;
  item_id: string;
  user_id: string;
  condition: Condition;
  wear_count: number;
  note: string | null;
  created_at: string;
}

export interface RetailerDurabilityRow {
  user_id: string;
  retailer: string;
  items: number;
  avg_wears: number;
  avg_price: number | null;
  avg_cost_per_wear: number | null;
  avg_condition: number | null;
  avg_wears_to_decline: number | null;
  worn_out_count: number;
}

export interface WeatherCacheRow {
  city_key: string;
  day: string;
  payload: Omit<WeatherContext, 'cityKey' | 'day'>;
  fetched_at: string;
}

// ───────────────────────────────────────────────────────────── row to app

export const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  displayName: r.display_name,
  avatarKey: r.avatar_key,
  city: r.city,
  country: r.country,
  timezone: r.timezone,
  plan: r.plan,
  planRenewsAt: r.plan_renews_at,
  itemCount: r.item_count,
  wardrobeVersion: r.wardrobe_version,
  currency: r.currency,
  cpwTarget: Number(r.cpw_target),
  onboarding: r.onboarding ?? {},
  createdAt: r.created_at,
});

export const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  slug: r.slug,
  icon: r.icon,
  defaultSlot: r.default_slot,
  subtypes: r.subtypes ?? [],
  outfitEligible: r.outfit_eligible,
  sortOrder: r.sort_order,
});

export const toItem = (r: ItemRow): Item => ({
  id: r.id,
  userId: r.user_id,
  status: r.status,
  storagePath: r.storage_path,
  thumbPath: r.thumb_path,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  contentHash: r.content_hash,
  name: r.name,
  notes: r.notes,
  categoryId: r.category_id,
  slot: r.slot,
  style: r.style,
  brand: r.brand,
  subtype: r.subtype,
  primaryColor: r.primary_color,
  colorHex: r.color_hex,
  secondaryColors: r.secondary_colors ?? [],
  pattern: r.pattern,
  material: r.material,
  formality: r.formality,
  warmth: r.warmth,
  seasons: r.seasons ?? [],
  aiConfidence: r.ai_confidence,
  aiModel: r.ai_model,
  userEdited: r.user_edited,
  userTags: r.user_tags ?? [],
  favourite: r.favourite,
  wearCount: r.wear_count,
  lastWornOn: r.last_worn_on,
  archived: r.archived,
  deletedAt: r.deleted_at,
  createdAt: r.created_at,
  price: r.price === null ? null : Number(r.price),
  currency: r.currency,
  purchasedOn: r.purchased_on,
  retailer: r.retailer,
  cpwTarget: r.cpw_target === null ? null : Number(r.cpw_target),
  costPerWear: r.cost_per_wear === null ? null : Number(r.cost_per_wear),
  initialWearCount: r.initial_wear_count,
  condition: r.condition,
  conditionRatedAt: r.condition_rated_at,
  conditionAtWear: r.condition_at_wear,
  retiredReason: r.retired_reason,
  retiredAt: r.retired_at,
});

export const toItemListView = (r: ItemListRow): ItemListView => ({
  id: r.id,
  status: r.status,
  thumbPath: r.thumb_path,
  categoryId: r.category_id,
  slot: r.slot,
  style: r.style,
  brand: r.brand,
  subtype: r.subtype,
  primaryColor: r.primary_color,
  colorHex: r.color_hex,
  formality: r.formality,
  warmth: r.warmth,
  seasons: r.seasons ?? [],
  userTags: r.user_tags ?? [],
  favourite: r.favourite,
  archived: r.archived,
  wearCount: r.wear_count,
});

export const toStyleProfile = (r: StyleProfileRow): StyleProfile => ({
  userId: r.user_id,
  colorAffinity: r.color_affinity ?? {},
  categoryAffinity: r.category_affinity ?? {},
  formalityBias: r.formality_bias,
  noveltyBias: r.novelty_bias,
  rejectedPairs: r.rejected_pairs ?? [],
  sampleCount: r.sample_count,
  updatedAt: r.updated_at,
});

export const toOutfit = (r: OutfitRow, items?: OutfitItem[]): Outfit => ({
  id: r.id,
  userId: r.user_id,
  source: r.source,
  style: r.style,
  season: r.season,
  tempBucket: r.temp_bucket,
  score: r.score,
  rationale: r.rationale,
  saved: r.saved,
  plannedFor: r.planned_for,
  createdAt: r.created_at,
  ...(items ? { items } : {}),
});

export const toOutfitItem = (r: OutfitItemRow): OutfitItem => ({
  outfitId: r.outfit_id,
  itemId: r.item_id,
  slot: r.slot,
});

export const toFeedback = (r: FeedbackRow): Feedback => ({
  id: r.id,
  userId: r.user_id,
  outfitId: r.outfit_id,
  itemId: r.item_id,
  kind: r.kind,
  createdAt: r.created_at,
});

export const toConditionLogEntry = (r: ConditionLogRow): ConditionLogEntry => ({
  id: r.id,
  itemId: r.item_id,
  userId: r.user_id,
  condition: r.condition,
  wearCount: r.wear_count,
  note: r.note,
  createdAt: r.created_at,
});

export const toRetailerDurability = (r: RetailerDurabilityRow): RetailerDurability => ({
  retailer: r.retailer,
  items: r.items,
  avgWears: Number(r.avg_wears),
  avgPrice: r.avg_price === null ? null : Number(r.avg_price),
  avgCostPerWear: r.avg_cost_per_wear === null ? null : Number(r.avg_cost_per_wear),
  avgCondition: r.avg_condition === null ? null : Number(r.avg_condition),
  avgWearsToDecline: r.avg_wears_to_decline === null ? null : Number(r.avg_wears_to_decline),
  wornOutCount: r.worn_out_count,
});

export const toWeatherContext = (r: WeatherCacheRow): WeatherContext => ({
  cityKey: r.city_key,
  day: r.day,
  ...r.payload,
});

// ───────────────────────────────────────────────────────────── app to row

/** Only the columns a client is ever allowed to write. */
export type ItemPatch = Partial<
  Pick<
    Item,
    | 'status'
    | 'name'
    | 'notes'
    | 'categoryId'
    | 'slot'
    | 'style'
    | 'brand'
    | 'subtype'
    | 'primaryColor'
    | 'colorHex'
    | 'secondaryColors'
    | 'pattern'
    | 'material'
    | 'formality'
    | 'warmth'
    | 'seasons'
    | 'userTags'
    | 'favourite'
    | 'archived'
    | 'userEdited'
    | 'price'
    | 'currency'
    | 'purchasedOn'
    | 'retailer'
    | 'cpwTarget'
  >
>;

export function toItemRow(patch: ItemPatch): Partial<ItemRow> {
  const row: Partial<ItemRow> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
  if (patch.slot !== undefined) row.slot = patch.slot;
  if (patch.style !== undefined) row.style = patch.style;
  if (patch.brand !== undefined) row.brand = patch.brand;
  if (patch.subtype !== undefined) row.subtype = patch.subtype;
  if (patch.primaryColor !== undefined) row.primary_color = patch.primaryColor;
  if (patch.colorHex !== undefined) row.color_hex = patch.colorHex;
  if (patch.secondaryColors !== undefined) row.secondary_colors = patch.secondaryColors;
  if (patch.pattern !== undefined) row.pattern = patch.pattern;
  if (patch.material !== undefined) row.material = patch.material;
  if (patch.formality !== undefined) row.formality = patch.formality;
  if (patch.warmth !== undefined) row.warmth = patch.warmth;
  if (patch.seasons !== undefined) row.seasons = patch.seasons;
  if (patch.userTags !== undefined) row.user_tags = patch.userTags;
  if (patch.favourite !== undefined) row.favourite = patch.favourite;
  if (patch.archived !== undefined) row.archived = patch.archived;
  if (patch.userEdited !== undefined) row.user_edited = patch.userEdited;
  if (patch.price !== undefined) row.price = patch.price;
  if (patch.currency !== undefined) row.currency = patch.currency;
  if (patch.purchasedOn !== undefined) row.purchased_on = patch.purchasedOn;
  if (patch.retailer !== undefined) row.retailer = patch.retailer;
  if (patch.cpwTarget !== undefined) row.cpw_target = patch.cpwTarget;
  return row;
}

export type ProfilePatch = Partial<
  Pick<
    Profile,
    'displayName' | 'city' | 'country' | 'timezone' | 'currency' | 'cpwTarget' | 'onboarding'
  >
>;

export function toProfileRow(patch: ProfilePatch): Partial<ProfileRow> {
  const row: Partial<ProfileRow> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.country !== undefined) row.country = patch.country;
  if (patch.timezone !== undefined) row.timezone = patch.timezone;
  if (patch.currency !== undefined) row.currency = patch.currency;
  if (patch.cpwTarget !== undefined) row.cpw_target = patch.cpwTarget;
  if (patch.onboarding !== undefined) row.onboarding = patch.onboarding;
  return row;
}
