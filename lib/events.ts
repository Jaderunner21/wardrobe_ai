/**
 * Analytics — module 14.
 *
 * At fifteen users this matters MORE than at five thousand, because there is no
 * aggregate to hide behind: every data point is one fifteenth of everything you know.
 * The whole apparatus is one table, one function, and four SQL queries in
 * `docs/queries.sql`. No dashboard — §6 is explicit that time spent building charts is
 * time not spent talking to the testers, which is the actual research method at this
 * size.
 *
 * FIRE AND FORGET (§2). `track()` never blocks a response and never throws into its
 * caller. An analytics write failing must not turn a successful upload into a 500.
 *
 * PRIVACY (§7). Events carry a user id and event-shaped properties: counts, ids, field
 * names, latencies. Never garment images, never signed URLs, never free text the user
 * wrote, and never colour data — that would let someone reconstruct a wardrobe from a
 * table that is not the one holding it under RLS. `scrubProps` enforces this rather
 * than trusting each call site to remember, because the call site that forgets is the
 * one nobody reviews.
 *
 * `events` has 30-day retention, pruned by a cron job that stays commented out until
 * production (module 02 §4). It is the only unbounded table that is not user-value
 * data, and at production scale it is over half the remaining headroom on a 500 MB
 * database — the retention job is what makes the capacity numbers work.
 */
import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Module 14's contract list, plus four this codebase already emits that the spec's list
 * predates. Snake_case because §1's queries are written against these literal strings.
 *
 * Three names below have no emitter yet, and deliberately: `chat_message` waits for
 * module 11's chat half, which module 16 §7.4 cut from the test phase, and the two
 * upgrade events wait for checkout, which module 13 does not contract. They stay in the
 * union because they are the contract; `scripts/check-events.sh` lists them as pending
 * so the gap is a checked fact rather than something to discover later.
 */
export type EventName =
  | 'signup'
  | 'onboarding_completed'
  | 'item_uploaded'
  | 'item_tagged'
  | 'item_corrected'
  | 'item_deleted'
  | 'item_restored'
  | 'item_archived'
  | 'item_saved'
  | 'item_discarded'
  | 'recommendations_viewed'
  | 'outfit_saved'
  | 'outfit_planned'
  | 'outfit_worn'
  | 'feedback_given'
  | 'chat_message'
  | 'quota_hit'
  | 'ai_budget_hit'
  | 'upgrade_prompt_shown'
  | 'upgrade_started';

/**
 * Property keys that must never reach the events table — §7.
 *
 * A denylist rather than an allowlist is the weaker choice in general, but here the
 * shape of a property bag is open by design and an allowlist would silently drop the
 * useful half of every new event. These are the specific things that would be a leak:
 * image locations (signed URLs, which are credentials with an expiry), anything a user
 * typed, and the colour fields that describe a garment.
 */
const FORBIDDEN_KEYS = new Set([
  'storagePath',
  'storage_path',
  'thumbPath',
  'thumb_path',
  'imageUrl',
  'image_url',
  'url',
  'signedUrl',
  'message',
  'text',
  'content',
  'prompt',
  'notes',
  'primaryColor',
  'primary_color',
  'colorHex',
  'color_hex',
  'secondaryColors',
]);

/** Anything that looks like a URL is dropped whatever it is called. */
const looksLikeUrl = (value: unknown): boolean =>
  typeof value === 'string' && /^https?:\/\//i.test(value);

/**
 * `item_corrected` is the exception that proves the rule: it carries the old and new
 * values of a corrected field, and for `primaryColor` that IS colour data. It is also
 * the single most useful number in the test phase, and the correction is meaningless
 * without knowing what it was corrected to. So values are truncated to a short string
 * rather than dropped — enough to read "navy → charcoal", not enough to be a wardrobe.
 */
const MAX_VALUE_LENGTH = 40;

export function scrubProps(props: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (looksLikeUrl(value)) continue;

    if (typeof value === 'string') {
      clean[key] = value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) : value;
      continue;
    }

    // Objects and arrays are not passed through: a nested bag is where a forbidden key
    // hides from the check above.
    if (value !== null && typeof value === 'object') continue;

    clean[key] = value;
  }

  return clean;
}

export async function track(
  name: EventName,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('events').insert({ user_id: user.id, name, props: scrubProps(props) });
  } catch (e) {
    console.error('[events]', name, e);
  }
}

/**
 * Emitted once per account, on the first sign-in — module 14 §1's onboarding funnel
 * starts here. Checking for an existing row rather than inferring from timestamps: a
 * magic link can be opened twice, and `signup` counted twice makes the funnel's
 * denominator wrong in the direction that flatters us.
 */
export async function trackSignupOnce(): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', 'signup')
      .limit(1)
      .maybeSingle();

    if (existing) return;

    await supabase.from('events').insert({ user_id: user.id, name: 'signup', props: {} });
  } catch (e) {
    console.error('[events] signup', e);
  }
}

/**
 * One `item_corrected` per changed AI field, with the old and new values — module 05
 * §4. Fields the AI never fills (price, notes, favourite …) are not corrections and are
 * not counted, or the metric measures data entry instead of model accuracy.
 */
const AI_FIELDS = [
  'categoryId',
  'slot',
  'style',
  'brand',
  'subtype',
  'primaryColor',
  'colorHex',
  'pattern',
  'material',
  'formality',
  'warmth',
  'seasons',
  'name',
] as const;

export type AiField = (typeof AI_FIELDS)[number];

/** How many AI-filled fields there are, so §1's correction rate has a denominator. */
export const AI_FIELD_COUNT = AI_FIELDS.length;

export function correctedFields(
  before: Partial<Record<AiField, unknown>>,
  patch: Partial<Record<AiField, unknown>>,
): { field: AiField; from: unknown; to: unknown }[] {
  const changes: { field: AiField; from: unknown; to: unknown }[] = [];

  for (const field of AI_FIELDS) {
    if (!(field in patch)) continue;
    const from = before[field];
    const to = patch[field];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    changes.push({ field, from: from ?? null, to: to ?? null });
  }
  return changes;
}

export async function trackCorrections(
  itemId: string,
  changes: { field: AiField; from: unknown; to: unknown }[],
): Promise<void> {
  await Promise.all(
    changes.map((c) =>
      track('item_corrected', {
        itemId,
        field: c.field,
        // Stringified so `scrubProps` can truncate them; an array of seasons would
        // otherwise be dropped as an object.
        from: short(c.from),
        to: short(c.to),
      }),
    ),
  );
}

const short = (value: unknown): string =>
  value === null || value === undefined ? '' : String(JSON.stringify(value)).slice(0, MAX_VALUE_LENGTH);
