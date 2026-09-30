/**
 * GET /api/admin/stats — the numbers on the console's Overview tab, plus the latest
 * events from the product log (module 14).
 */
import { handle, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export interface AdminStats {
  users: number;
  signups7d: number;
  items: number;
  savedOutfits: number;
  wears7d: number;
  aiToday: { tagCalls: number; llmCalls: number; inTokens: number; outTokens: number };
  events: { id: number; name: string; who: string | null; createdAt: string; props: Record<string, unknown> }[];
}

const todayInIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const GET = handle(async () => {
  await requireAdmin();
  const db = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const count = { count: 'exact' as const, head: true };

  const [users, signups, items, outfits, wears, usage, events] = await Promise.all([
    db.from('profiles').select('id', count),
    db.from('profiles').select('id', count).gte('created_at', weekAgo),
    db.from('items').select('id', count).is('deleted_at', null).eq('status', 'ready'),
    db.from('outfits').select('id', count).eq('saved', true),
    db.from('feedback').select('id', count).eq('kind', 'worn').gte('created_at', weekAgo),
    db.from('ai_usage').select('tag_calls, llm_calls, in_tokens, out_tokens').eq('day', todayInIndia()),
    db.from('events').select('id, name, user_id, props, created_at').order('created_at', { ascending: false }).limit(30),
  ]);

  const eventRows = (events.data ?? []) as {
    id: number; name: string; user_id: string | null; props: Record<string, unknown>; created_at: string;
  }[];
  const ids = [...new Set(eventRows.map((e) => e.user_id).filter((x): x is string => Boolean(x)))];
  const { data: names } = ids.length
    ? await db.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] as { id: string; display_name: string | null }[] };
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.display_name]));

  const ai = (usage.data ?? []).reduce(
    (sum, r) => ({
      tagCalls: sum.tagCalls + (r.tag_calls ?? 0),
      llmCalls: sum.llmCalls + (r.llm_calls ?? 0),
      inTokens: sum.inTokens + Number(r.in_tokens ?? 0),
      outTokens: sum.outTokens + Number(r.out_tokens ?? 0),
    }),
    { tagCalls: 0, llmCalls: 0, inTokens: 0, outTokens: 0 },
  );

  const stats: AdminStats = {
    users: users.count ?? 0,
    signups7d: signups.count ?? 0,
    items: items.count ?? 0,
    savedOutfits: outfits.count ?? 0,
    wears7d: wears.count ?? 0,
    aiToday: ai,
    events: eventRows.map((e) => ({
      id: e.id,
      name: e.name,
      who: e.user_id ? (nameOf.get(e.user_id) ?? e.user_id.slice(0, 8)) : null,
      createdAt: e.created_at,
      props: e.props ?? {},
    })),
  };
  return ok(stats);
});
