/**
 * GET   /api/admin/plans — what each plan currently includes
 * PATCH /api/admin/plans — change it, without a deploy
 *
 * These rows are what `lib/budget.ts` reads before every model call, so a change here
 * takes effect on the next request. `itemCap: null` means unlimited.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export interface PlanFeatureRow {
  plan: 'free' | 'premium';
  tagLimit: number;
  chatLimit: number;
  rerankLimit: number;
  itemCap: number | null;
}

interface PlanFeatureDbRow {
  plan: 'free' | 'premium';
  tag_limit: number;
  chat_limit: number;
  rerank_limit: number;
  item_cap: number | null;
}

const patchSchema = z.object({
  plan: z.enum(['free', 'premium']),
  tagLimit: z.number().int().min(0).max(10_000),
  chatLimit: z.number().int().min(0).max(10_000),
  rerankLimit: z.number().int().min(0).max(10_000),
  itemCap: z.number().int().min(0).max(1_000_000).nullable(),
});

const toPlanFeature = (row: PlanFeatureDbRow): PlanFeatureRow => ({
  plan: row.plan,
  tagLimit: row.tag_limit,
  chatLimit: row.chat_limit,
  rerankLimit: row.rerank_limit,
  itemCap: row.item_cap,
});

export const GET = handle(async () => {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('plan_features')
    .select('plan, tag_limit, chat_limit, rerank_limit, item_cap')
    .order('plan');
  if (error) throw error;

  return ok({ plans: ((data ?? []) as unknown as PlanFeatureDbRow[]).map(toPlanFeature) });
});

export const PATCH = handle(async (request: Request) => {
  await requireAdmin();
  const body = await parseBody(request, patchSchema);

  // RLS allows this write because the caller is an admin (0010), so the ordinary
  // session client is enough — no service-role key needed here.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plan_features')
    .update({
      tag_limit: body.tagLimit,
      chat_limit: body.chatLimit,
      rerank_limit: body.rerankLimit,
      item_cap: body.itemCap,
      updated_at: new Date().toISOString(),
    })
    .eq('plan', body.plan)
    .select('plan, tag_limit, chat_limit, rerank_limit, item_cap')
    .single();
  if (error) throw error;

  return ok({ plan: toPlanFeature(data as unknown as PlanFeatureDbRow) });
});
