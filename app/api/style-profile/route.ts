/**
 * PATCH /api/style-profile — module 10 §3.
 *
 * The only thing a client may write here is the veto list, and only by shortening it.
 * Affinities are learned from feedback and never set directly: a profile you can edit
 * by hand is one you cannot replay from the feedback that produced it, which is the
 * property that makes this module debuggable at all.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { MAX_REJECTED_PAIRS } from '@/lib/learning';
import { toStyleProfile, type StyleProfileRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const STYLE_PROFILE_COLUMNS =
  'user_id, color_affinity, category_affinity, formality_bias, novelty_bias, rejected_pairs, sample_count, updated_at';

const bodySchema = z.object({
  rejectedPairs: z
    .array(z.tuple([z.string().min(1).max(40), z.string().min(1).max(40)]))
    .max(MAX_REJECTED_PAIRS),
});

export const PATCH = handle(async (request: Request) => {
  const user = await requireUser();
  const { rejectedPairs } = await parseBody(request, bodySchema);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('style_profiles')
    .update({ rejected_pairs: rejectedPairs, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .select(STYLE_PROFILE_COLUMNS)
    .single();
  if (error) throw error;

  return ok({ styleProfile: toStyleProfile(data as unknown as StyleProfileRow) });
});
