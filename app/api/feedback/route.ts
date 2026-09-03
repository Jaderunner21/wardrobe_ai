/**
 * POST /api/feedback — module 10.
 *
 * Synchronous by design (§4): the update is arithmetic on a small object plus one row
 * write. A job queue for this would be more moving parts than the work itself.
 *
 * The route does the impure half — reads the outfit, counts the user's down-votes,
 * writes the rows — and `applyFeedback` does the arithmetic, so a profile can always be
 * replayed from the feedback that produced it.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { applyFeedback, colorPairsOf } from '@/lib/learning';
import { toItem, toStyleProfile, type ItemRow, type StyleProfileRow } from '@/lib/mappers';
import { track } from '@/lib/events';
import type { FeedbackKind, Item, RecommendationSource } from '@/types';

export const dynamic = 'force-dynamic';

const ITEM_COLUMNS =
  'id, user_id, status, storage_path, thumb_path, bytes, width, height, content_hash, name, notes, category_id, slot, style, brand, subtype, primary_color, color_hex, secondary_colors, pattern, material, formality, warmth, seasons, ai_confidence, ai_model, user_edited, user_tags, favourite, wear_count, last_worn_on, archived, deleted_at, created_at, price, currency, purchased_on, retailer, cpw_target, cost_per_wear, initial_wear_count, condition, condition_rated_at, condition_at_wear, retired_reason, retired_at';

const STYLE_PROFILE_COLUMNS =
  'user_id, color_affinity, category_affinity, formality_bias, novelty_bias, rejected_pairs, sample_count, updated_at';

const bodySchema = z
  .object({
    outfitId: z.string().uuid().optional(),
    itemId: z.string().uuid().optional(),
    kind: z.enum(['up', 'down', 'worn', 'skipped']),
    /** For backdating a wear the user forgot to log (0005_wear_logging.sql). */
    wornOn: z.string().date().optional(),
  })
  .refine((b) => b.outfitId || b.itemId, {
    message: 'Say what the feedback is about.',
    path: ['outfitId'],
  });

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const body = await parseBody(request, bodySchema);
  const supabase = await createClient();

  const items = await subjectItems(supabase, body.outfitId, body.itemId);
  if (items.length === 0) throw appError('NOT_FOUND');

  /**
   * A wear is recorded through `log_wear`, not by writing the row here: that function
   * is idempotent per (item, day), so tapping twice on the same date does not
   * double-count, and it keeps wear_count and last_worn_on in step with the feedback
   * row. Every other kind is a plain insert.
   */
  if (body.kind === 'worn') {
    for (const item of items) {
      const { error } = await supabase.rpc('log_wear', {
        p_item_id: item.id,
        p_worn_on: body.wornOn ?? null,
      });
      if (error) throw error;
    }
    if (body.outfitId) {
      // One row for the outfit itself, so the thumbs-up rate and the wear history are
      // both answerable from `feedback` alone.
      await supabase
        .from('feedback')
        .insert({ user_id: user.id, outfit_id: body.outfitId, kind: 'worn' });
    }
  } else {
    const { error } = await supabase.from('feedback').insert({
      user_id: user.id,
      outfit_id: body.outfitId ?? null,
      item_id: body.itemId ?? null,
      kind: body.kind,
    });
    if (error) throw error;
  }

  await updateStyleProfile(supabase, user.id, items, body.kind);

  /**
   * Module 14 §1's recommendation-quality signal, and two of module 19 §7's three
   * numbers. `kind` carries the thumbs-up/down; `source` says which engine produced the
   * outfit, without which the comparison cannot be made at all.
   *
   * No colours, no item names — §7. Which garments were thumbed down is already in
   * `feedback`, under RLS, where it belongs.
   */
  const source = body.outfitId ? await outfitSource(supabase, body.outfitId) : null;

  await track('feedback_given', {
    kind: body.kind,
    subject: body.outfitId ? 'outfit' : 'item',
    source,
  });

  // A wear against a whole outfit is the strongest signal there is: not "I like this"
  // but "I wore it". Counted separately for that reason.
  if (body.kind === 'worn' && body.outfitId) {
    await track('outfit_worn', { outfitId: body.outfitId, source });
  }

  return ok({ ok: true });
});

/** Which engine produced this outfit — module 19 §7's comparison needs it per event. */
async function outfitSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  outfitId: string,
): Promise<RecommendationSource | null> {
  const { data } = await supabase
    .from('outfits')
    .select('source')
    .eq('id', outfitId)
    .maybeSingle();

  return (data?.source as RecommendationSource | undefined) ?? null;
}

/** The items the feedback is about: a whole outfit, or a single garment. */
async function subjectItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  outfitId?: string,
  itemId?: string,
): Promise<Item[]> {
  if (outfitId) {
    const { data, error } = await supabase
      .from('outfit_items')
      .select(`item_id, items(${ITEM_COLUMNS})`)
      .eq('outfit_id', outfitId);
    if (error) throw error;

    return ((data ?? []) as unknown as { items: ItemRow | null }[])
      .map((row) => row.items)
      .filter((row): row is ItemRow => row !== null)
      .map(toItem);
  }

  const { data, error } = await supabase
    .from('items')
    .select(ITEM_COLUMNS)
    .eq('id', itemId ?? '')
    .maybeSingle();
  if (error) throw error;

  return data ? [toItem(data as unknown as ItemRow)] : [];
}

async function updateStyleProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  items: Item[],
  kind: FeedbackKind,
): Promise<void> {
  const { data: profileRow, error } = await supabase
    .from('style_profiles')
    .select(STYLE_PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  // Seeded by the auth trigger (module 03 §2); nothing to learn into if it is missing.
  if (!profileRow) return;

  const profile = toStyleProfile(profileRow as unknown as StyleProfileRow);

  const next = applyFeedback(profile, items, kind, {
    downPairCounts: kind === 'down' ? await countDownPairs(supabase, items) : undefined,
  });

  const { error: writeError } = await supabase
    .from('style_profiles')
    .update({
      color_affinity: next.colorAffinity,
      category_affinity: next.categoryAffinity,
      formality_bias: next.formalityBias,
      rejected_pairs: next.rejectedPairs,
      sample_count: next.sampleCount,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (writeError) throw writeError;
}

/**
 * How many times each colour pair in this outfit has been thumbed down, including the
 * vote just cast. Three is a veto (§3) — the user told you three times, so the engine
 * discards the pair rather than penalising it.
 */
async function countDownPairs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: Item[],
): Promise<Record<string, number>> {
  const wanted = new Set(colorPairsOf(items));
  if (wanted.size === 0) return {};

  const { data, error } = await supabase
    .from('feedback')
    .select('outfit_id')
    .eq('kind', 'down')
    .not('outfit_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const outfitIds = [...new Set((data ?? []).map((r) => r.outfit_id as string))];
  if (outfitIds.length === 0) return {};

  const { data: rows, error: itemsError } = await supabase
    .from('outfit_items')
    .select('outfit_id, items(primary_color)')
    .in('outfit_id', outfitIds);
  if (itemsError) throw itemsError;

  const coloursByOutfit = new Map<string, string[]>();
  for (const row of (rows ?? []) as unknown as {
    outfit_id: string;
    items: { primary_color: string | null } | null;
  }[]) {
    const colour = row.items?.primary_color;
    if (!colour) continue;
    coloursByOutfit.set(row.outfit_id, [
      ...(coloursByOutfit.get(row.outfit_id) ?? []),
      colour,
    ]);
  }

  const counts: Record<string, number> = {};
  for (const colours of coloursByOutfit.values()) {
    const pairs = colorPairsOf(
      colours.map((c) => ({ primaryColor: c }) as Item),
    );
    for (const key of pairs) {
      if (wanted.has(key)) counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}
