/**
 * Wardrobe AI — shared types. Single source of truth.
 * Copy verbatim to `types/index.ts`. Do not redeclare any of these locally.
 *
 * Field names here are camelCase (application side). The Postgres columns are
 * snake_case; mapping happens once, in `lib/mappers.ts`.
 */

// ─────────────────────────────────────────────────────────── enums

export type Plan = 'free' | 'premium';

/**
 * uploaded → tagging → draft → ready       ("Save All to Wardrobe" flips draft → ready)
 *                  ↘ failed → draft        (user fills it in by hand)
 * Drafts are the prototype's Review & Edit step. They count toward the quota — their
 * bytes are already uploaded — and are invisible everywhere except the upload screen.
 */
export type ItemStatus = 'uploaded' | 'tagging' | 'draft' | 'ready' | 'failed';

/**
 * Structural slot. INTERNAL — never shown to the user. Drives outfit assembly.
 * Distinct from Category, which is what the UI displays and users can extend.
 * See module 16 §7.1: Activewear contains both tops and bottoms, so one enum
 * could not serve both axes.
 */
export type Slot =
  | 'top' | 'bottom' | 'fullbody' | 'outerwear' | 'footwear' | 'accessory';

export type Pattern = 'solid' | 'striped' | 'checked' | 'printed' | 'textured';

export type Season = 'summer' | 'monsoon' | 'winter' | 'all';

/** User-facing style facet. One per item. Drives the wardrobe sidebar counts. */
export type Style =
  | 'lounge' | 'workout' | 'casual' | 'date-night' | 'party' | 'business' | 'formal';

export type FeedbackKind = 'up' | 'down' | 'worn' | 'skipped';

/** 5 like new · 4 good · 3 worn but fine · 2 visible wear · 1 worn out. USER-RATED. */
export type Condition = 1 | 2 | 3 | 4 | 5;

export type RetiredReason =
  | 'worn_out' | 'no_longer_fits' | 'disliked' | 'sold' | 'donated' | 'lost' | 'other';

export type RecommendationSource = 'rules' | 'llm' | 'manual';

/** 1 = loungewear, 3 = smart casual, 5 = black tie. */
export type Formality = 1 | 2 | 3 | 4 | 5;

/** 1 = single light layer, 5 = heavy winter. */
export type Warmth = 1 | 2 | 3 | 4 | 5;

/** Quantised temperature. See module 07 for boundaries. */
export type TempBucket = 0 | 1 | 2 | 3 | 4;

// ─────────────────────────────────────────────────────────── entities

export interface Profile {
  id: string;                       // = auth.users.id
  displayName: string | null;
  avatarKey: string | null;
  city: string | null;
  country: string;                  // ISO-3166 alpha-2, default 'IN'
  timezone: string;                 // IANA, default 'Asia/Kolkata'
  plan: Plan;
  planRenewsAt: string | null;      // ISO 8601
  itemCount: number;                // denormalised; maintained by DB trigger
  wardrobeVersion: number;          // bumped on any item change; recommendation cache key
  currency: string;                 // ISO 4217, default 'INR'
  cpwTarget: number;                // default cost-per-wear goal, default 100
  onboarding: Record<string, unknown>;
  /** Module 16 §4's Appearance tab. Server-read, so not localStorage — see 0012. */
  preferences: Preferences;
  /** Module 19 §7's rollout switches. Absent means "assign me by the default rule". */
  flags: Flags;
  createdAt: string;
}

/**
 * Feature assignment, per user. Deliberately not a display preference: this decides
 * which engine picks someone's outfits, and module 19 §7 requires it be comparable
 * across two arms for two weeks before the losing one is deleted.
 */
export interface Flags {
  aiRecommendations?: boolean;
}

/**
 * How the app presents things, as opposed to what it knows. Every field is optional:
 * an absent preference means "whatever the default is", which is what a fresh profile
 * has and what an older row that predates the column has too.
 */
export interface Preferences {
  dateFormat?: DateFormat;
  defaultSort?: ItemSort;
  /** Wardrobe grid or list. A view choice, so it lives with the other view choices. */
  wardrobeView?: 'grid' | 'list';
}

/**
 * Explicit formats rather than a locale string. "8/28/2025" and "28/8/2025" are the
 * same date and different numbers, and module 16 §6.6 caught the prototype showing a
 * member-since date a year out — an ambiguous format is how that goes unnoticed.
 */
export type DateFormat = 'dmy' | 'mdy' | 'iso' | 'long';

export type ItemSort = 'recent' | 'least-worn' | 'recently-worn' | 'cost-per-wear';

/** Display + filter axis. Nine seeded defaults; users may add their own. */
export interface Category {
  id: string;
  userId: string | null;          // null = system default, visible to everyone
  name: string;                   // "Tops", "Ethnic Wear"
  slug: string;
  icon: string | null;            // emoji, as the prototype uses
  defaultSlot: Slot;              // suggested slot for items filed here
  subtypes: string[];             // chips shown in Settings → Categories
  outfitEligible: boolean;        // false for Underwear and Sleepwear
  sortOrder: number;
}

export interface Item {
  id: string;
  userId: string;
  status: ItemStatus;

  // storage — the DB holds paths, never URLs. URLs are generated at read time
  // (signed, day-rounded) so the storage provider can change without a migration.
  storagePath: string;
  thumbPath: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  contentHash: string | null;       // sha-256 hex

  name: string | null;              // "Brown Leather Briefcase" — what the user reads
  notes: string | null;             // free-text, user only

  // AI-extracted, user-correctable
  categoryId: string | null;        // → Category. What the UI shows.
  slot: Slot | null;                // internal. What module 08 assembles on.
  style: Style | null;              // single value, not an array
  brand: string | null;             // "Levi's", "Uniqlo" — right-aligned on the card
  subtype: string | null;           // free text, never used for logic
  primaryColor: string | null;      // colour name
  colorHex: string | null;          // '#rrggbb'
  secondaryColors: string[];
  pattern: Pattern | null;
  material: string | null;
  formality: Formality | null;
  warmth: Warmth | null;
  seasons: Season[];
  aiConfidence: number | null;      // 0..1
  aiModel: string | null;
  userEdited: boolean;

  // user state
  userTags: string[];
  favourite: boolean;
  wearCount: number;
  lastWornOn: string | null;        // ISO date

  /**
   * Two different states — see module 16 §7.3.
   *   archived        owned, out of rotation. COUNTS toward the free quota.
   *   deletedAt       in the Bin. Does NOT count. Purged with its images after 30 days.
   */
  archived: boolean;
  deletedAt: string | null;
  createdAt: string;

  /**
   * Purchase history — USER-ENTERED ONLY. The AI never fills these in (module 17 §3):
   * a vision model cannot see what something cost, and a plausible guess corrupts a
   * financial record silently.
   */
  price: number | null;
  currency: string | null;          // ISO 4217; falls back to profile.currency
  purchasedOn: string | null;       // ISO date
  retailer: string | null;
  cpwTarget: number | null;         // per-item override of profile.cpwTarget
  costPerWear: number | null;       // GENERATED by Postgres: price / max(wearCount,1)

  /**
   * Wear count is the USER's number — module 18 §3b. It increments by one on every
   * wearing, and can also be backdated, undone, or set directly. `initialWearCount`
   * holds the part the user estimated when digitising an item they already owned,
   * so a measured 40 stays distinguishable from a guessed 40.
   */
  initialWearCount: number;

  /** Wear & tear — module 18. User-rated, never inferred from a photo. */
  condition: Condition | null;
  conditionRatedAt: string | null;
  conditionAtWear: number | null;   // wearCount when last rated — makes the series usable
  retiredReason: RetiredReason | null;
  retiredAt: string | null;
}

/** One immutable row per rating. The history, not the current value. */
export interface ConditionLogEntry {
  id: number;
  itemId: string;
  userId: string;
  condition: Condition;
  wearCount: number;                // snapshot at rating time
  note: string | null;
  createdAt: string;
}

/** Module 18 §4. The user's own record of their purchases, not a public rating. */
export interface RetailerDurability {
  retailer: string;
  items: number;                    // never reported below 3
  avgWears: number;
  avgPrice: number | null;
  avgCostPerWear: number | null;
  avgCondition: number | null;
  avgWearsToDecline: number | null; // wears at which items first hit condition <= 2
  wornOutCount: number;
}

/**
 * Columns a list view is allowed to select. Enforced by convention, see 01.
 *
 * DIVERGES from wardrobe-ai-spec/types.ts by one column: `name`. The spec's own
 * module 05 §2b says `name` is "what a person recognises in a grid of 60 thumbnails",
 * and module 16 §3 puts it on the card — but the list was written before
 * 0003_item_history.sql added the column. One short text column; `ai_raw` and the
 * purchase history stay out, which is where the egress actually is.
 */
export const ITEM_LIST_COLUMNS = [
  'id', 'status', 'thumb_path', 'name', 'category_id', 'slot', 'style', 'brand',
  'subtype', 'primary_color', 'color_hex', 'formality', 'warmth', 'seasons',
  'user_tags', 'favourite', 'archived', 'wear_count',
  // Module 18 §6 puts a condition dot on the card and a "needs replacing" filter in
  // the bar, and §3's rating prompt needs to know the wear count at the last rating.
  // Two small integers; the egress that matters is `ai_raw` and it stays out.
  'condition', 'condition_at_wear',
] as const;

export interface StyleProfile {
  userId: string;
  /** colour name → −1 (avoid) .. +1 (prefer) */
  colorAffinity: Record<string, number>;
  categoryAffinity: Record<string, number>;
  /** −1 casual .. +1 formal; shifts the target formality */
  formalityBias: number;
  /** 0 .. 1; how strongly to reward unseen combinations */
  noveltyBias: number;
  /** hard vetoes, e.g. [['navy','black']] — order-insensitive */
  rejectedPairs: [string, string][];
  sampleCount: number;
  updatedAt: string;
}

export interface Outfit {
  id: string;
  userId: string;
  source: RecommendationSource;
  style: Style | null;
  season: Season | null;
  tempBucket: TempBucket | null;
  score: number | null;
  rationale: string | null;         // short "why this works"
  saved: boolean;
  plannedFor: string | null;        // ISO date — the outfit calendar
  createdAt: string;
  items?: OutfitItem[];             // hydrated on read
}

export interface OutfitItem {
  outfitId: string;
  itemId: string;
  slot: Slot;
  item?: Item;                      // hydrated on read
}

export interface Feedback {
  id: number;
  userId: string;
  outfitId: string | null;
  itemId: string | null;
  kind: FeedbackKind;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────── runtime

export interface WeatherContext {
  cityKey: string;                  // 'udaipur,in' — lowercased
  day: string;                      // ISO date
  tempC: number;                    // representative daytime temp
  tempMinC: number;
  tempMaxC: number;
  tempBucket: TempBucket;
  precipitationMm: number;
  condition: string;                // free text, display only
}

/** Everything the recommendation engine needs. Built by the caller, pure input. */
export interface RecommendationContext {
  userId: string;
  items: Item[];                    // status 'ready', not archived
  styleProfile: StyleProfile;
  style: Style;
  weather: WeatherContext | null;   // null → skip thermal scoring
  season: Season;
  /** item id pairs already surfaced, for the novelty term */
  seenPairs: Set<string>;
  limit: number;                    // default 5
}

export interface ScoredPair {
  a: Item;
  b: Item;
  score: number;
  terms: ScoreTerms;                // kept for debugging and the LLM prompt
}

export interface ScoreTerms {
  colorHarmony: number;
  formalityCoherence: number;
  thermalFit: number;
  styleAffinity: number;
  recency: number;
  novelty: number;
}

export interface Recommendation {
  items: Item[];                    // one per filled slot
  slots: Slot[];            // parallel to items
  score: number;
  rationale: string | null;         // null until the LLM layer fills it (module 11)
  source: RecommendationSource;
}

/** Module 17. Derived, never stored except `costPerWear` which Postgres generates. */
export interface CostPerWear {
  cpw: number | null;               // null when price is unset
  wears: number;
  target: number;                   // item override, else profile default
  wearsToTarget: number | null;     // more wears needed to reach it
  reachedTarget: boolean;
  daysOwned: number | null;
  wearsPerMonth: number | null;
}

// ─────────────────────────────────────────────────────────── AI

/** Exactly what the vision model is allowed to return. See module 06. */
export interface TagResult {
  /**
   * A short human name — "Navy Oxford Shirt". ADDED to the spec's TagResult: module 05
   * §2b calls `name` "what a person recognises in a grid of 60 thumbnails" and module
   * 16 §3 puts it on the card, but nothing was filling it, so every AI-tagged item
   * arrived nameless. Optional, because an older stored response will not have one.
   */
  name?: string;
  slot: Slot;
  categorySlug: string;   // matched against the user's categories
  style: Style;
  subtype: string;
  primaryColor: string;
  colorHex: string;
  secondaryColors: string[];
  pattern: Pattern;
  material: string;
  formality: Formality;
  warmth: Warmth;
  seasons: Season[];
  confidence: number;
}

export type AiCallKind = 'tag' | 'chat' | 'rerank';

export interface AiUsage {
  userId: string;
  day: string;                      // ISO date
  tagCalls: number;
  chatCalls: number;
  llmCalls: number;
  inTokens: number;
  outTokens: number;
}

/** Per-plan daily ceilings. Enforced BEFORE the model call. See module 12. */
export const AI_LIMITS: Record<Plan, Record<AiCallKind, number>> = {
  free:    { tag: 40,  chat: 0,  rerank: 0  },
  premium: { tag: 100, chat: 20, rerank: 15 },
};

/** Test phase only: testers are seeded premium, limits raised. See module 12. */
export const AI_LIMITS_TEST: Record<Plan, Record<AiCallKind, number>> = {
  free:    { tag: 100, chat: 50, rerank: 50 },
  premium: { tag: 100, chat: 50, rerank: 50 },
};

// ─────────────────────────────────────────────────────────── errors

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'ITEM_QUOTA_EXCEEDED'
  | 'DUPLICATE_ITEM'
  | 'PREMIUM_REQUIRED'
  | 'AI_BUDGET_EXCEEDED'
  | 'AI_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string> | null;
  };
}

// ─────────────────────────────────────────────────────────── constants

export const FREE_ITEM_CAP = 25;

/** Longest edge, px, of the stored image. See module 04. */
export const IMAGE_MAX_EDGE = 800;
export const THUMB_MAX_EDGE = 240;
export const IMAGE_QUALITY = 0.70;

/** Default cost-per-wear goal. A target the user chose, not a verdict — module 17 §2. */
export const DEFAULT_CPW_TARGET = 100;

/** Abandoned Review & Edit drafts are binned after this long. */
export const DRAFT_TTL_HOURS = 24;

/** Condition prompting — module 18 §3. Never every wear; that kills the habit. */
export const CONDITION_FIRST_PROMPT_WEARS = 10;
export const CONDITION_REPROMPT_WEARS = 15;

/** Minimum items from a retailer before durability is reported at all. */
export const RETAILER_MIN_ITEMS = 3;

/** Fraction of an item's wear history that was observed rather than estimated. */
export const wearConfidence = (i: Pick<Item,'wearCount'|'initialWearCount'>): number =>
  i.wearCount === 0 ? 1 : (i.wearCount - i.initialWearCount) / i.wearCount;

/** Target formality per style. See module 08 §1. */
export const STYLE_FORMALITY: Record<Style, number> = {
  lounge: 1, workout: 1, casual: 2, 'date-night': 3, party: 3, business: 4, formal: 5,
};

/** Raw engine scores sit in 0.70-0.85. The UI shows "95% Match". Map, don't retune. */
export const matchPercent = (score: number) => Math.round(50 + score * 50);

/** Sum of item warmth the engine aims for, indexed by TempBucket. */
export const TARGET_WARMTH_SUM: Record<TempBucket, number> = {
  0: 11, 1: 9, 2: 7, 3: 5, 4: 3,
};
