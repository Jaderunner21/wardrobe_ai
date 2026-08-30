/**
 * GET /api/account/export — module 03 §5.
 *
 * A single JSON file: profile, items, outfits, feedback, style profile, plus a map of
 * item id to a 24-hour signed image URL. Generated on demand, never stored.
 *
 * This is the cheapest possible answer to "what happens to my photos", and you will
 * be asked.
 */
import { handle } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors';
import { EXPORT_URL_TTL_SECONDS, signedUrls } from '@/lib/storage';
import {
  toFeedback,
  toItem,
  toOutfit,
  toOutfitItem,
  toProfile,
  toStyleProfile,
  type FeedbackRow,
  type ItemRow,
  type OutfitItemRow,
  type OutfitRow,
  type ProfileRow,
  type StyleProfileRow,
} from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const PROFILE_COLUMNS =
  'id, display_name, avatar_key, city, country, timezone, plan, plan_renews_at, item_count, wardrobe_version, currency, cpw_target, onboarding, created_at';

const ITEM_COLUMNS =
  'id, user_id, status, storage_path, thumb_path, bytes, width, height, content_hash, name, notes, category_id, slot, style, brand, subtype, primary_color, color_hex, secondary_colors, pattern, material, formality, warmth, seasons, ai_confidence, ai_model, user_edited, user_tags, favourite, wear_count, last_worn_on, archived, deleted_at, created_at, price, currency, purchased_on, retailer, cpw_target, cost_per_wear, initial_wear_count, condition, condition_rated_at, condition_at_wear, retired_reason, retired_at';

const OUTFIT_COLUMNS =
  'id, user_id, source, style, season, temp_bucket, score, rationale, saved, planned_for, created_at';

const STYLE_PROFILE_COLUMNS =
  'user_id, color_affinity, category_affinity, formality_bias, novelty_bias, rejected_pairs, sample_count, updated_at';

export const GET = handle(async () => {
  const user = await requireUser();
  const supabase = await createClient();

  // RLS scopes every one of these to the caller — no manual user_id filter needed.
  const [profileRes, itemsRes, outfitsRes, outfitItemsRes, feedbackRes, styleRes] =
    await Promise.all([
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).single(),
      supabase.from('items').select(ITEM_COLUMNS).order('created_at', { ascending: true }),
      supabase.from('outfits').select(OUTFIT_COLUMNS).order('created_at', { ascending: true }),
      supabase.from('outfit_items').select('outfit_id, item_id, slot'),
      supabase
        .from('feedback')
        .select('id, user_id, outfit_id, item_id, kind, worn_on, created_at')
        .order('created_at', { ascending: true }),
      supabase.from('style_profiles').select(STYLE_PROFILE_COLUMNS).eq('user_id', user.id).single(),
    ]);

  const failed = [profileRes, itemsRes, outfitsRes, outfitItemsRes, feedbackRes, styleRes].find(
    (r) => r.error,
  );
  if (failed?.error) throw failed.error;
  if (!profileRes.data || !styleRes.data) throw appError('NOT_FOUND');

  const itemRows = (itemsRes.data ?? []) as unknown as ItemRow[];
  const outfitItemRows = (outfitItemsRes.data ?? []) as unknown as OutfitItemRow[];
  const items = itemRows.map(toItem);

  const byOutfit = new Map<string, ReturnType<typeof toOutfitItem>[]>();
  for (const row of outfitItemRows) {
    const list = byOutfit.get(row.outfit_id) ?? [];
    list.push(toOutfitItem(row));
    byOutfit.set(row.outfit_id, list);
  }

  // One signed URL per stored object, valid 24h. A path that fails to sign is simply
  // absent from the map rather than failing the export.
  const paths = itemRows.flatMap((r) => [r.storage_path, r.thumb_path]).filter(Boolean);
  const urlsByPath = await signedUrls(supabase, paths, EXPORT_URL_TTL_SECONDS);
  const imageUrls: Record<string, string> = {};
  for (const row of itemRows) {
    const url = urlsByPath[row.storage_path];
    if (url) imageUrls[row.id] = url;
  }

  const body = {
    exportedAt: new Date().toISOString(),
    profile: toProfile(profileRes.data as unknown as ProfileRow),
    items,
    outfits: ((outfitsRes.data ?? []) as unknown as OutfitRow[]).map((r) =>
      toOutfit(r, byOutfit.get(r.id) ?? []),
    ),
    feedback: ((feedbackRes.data ?? []) as unknown as FeedbackRow[]).map(toFeedback),
    styleProfile: toStyleProfile(styleRes.data as unknown as StyleProfileRow),
    imageUrls,
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="wardrobe-export.json"',
      'cache-control': 'no-store',
    },
  });
});
