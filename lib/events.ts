/**
 * Analytics writes (module 14 owns the full thing; this is the minimum module 05
 * needs — §4's `item.corrected` stream is the correction rate, and it is the single
 * most useful number in the test phase).
 *
 * Never throws and never blocks the response. A failed analytics write must not turn
 * a successful edit into a 500.
 *
 * `events` has 30-day retention, pruned by a cron job that is commented out until
 * production (module 02 §4).
 */
import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type EventName =
  | 'item.created'
  | 'item.corrected'
  | 'item.deleted'
  | 'item.restored'
  | 'item.archived'
  | 'item.saved'
  | 'item.discarded'
  | 'quota.blocked';

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

    await supabase.from('events').insert({ user_id: user.id, name, props });
  } catch (e) {
    console.error('[events]', name, e);
  }
}

/**
 * One `item.corrected` per changed AI field, with the old and new values — module 05
 * §4. Fields the AI never fills (price, notes, favourite …) are not corrections and
 * are not counted, or the metric measures data entry instead of model accuracy.
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
    changes.map((c) => track('item.corrected', { itemId, field: c.field, from: c.from, to: c.to })),
  );
}
