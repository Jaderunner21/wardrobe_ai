/**
 * The AI budget guard — module 12. Server only.
 *
 * Small module, disproportionate importance: one scripted retry loop against an
 * unmetered endpoint is a five-figure bill, and from the billing API's point of view
 * an attacker and a friend whose client got stuck in a loop are the same thing.
 *
 * Every model call in the codebase passes through `assertBudget` first. CI greps for
 * it (`scripts/check-budget-guard.sh`), because a call site that forgets is invisible
 * in review.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { appError } from '@/lib/errors';
import { AI_LIMITS, AI_LIMITS_TEST, type AiCallKind, type AiUsage, type Plan } from '@/types';

/**
 * The compile-time fallback. `plan_features` (0010) is the real source of truth, so an
 * operator can change what a plan includes without a deploy; this is what answers when
 * that table cannot be read — a DB blip must not silently hand out unlimited AI.
 *
 * Test phase raises the caps so testers are not throttled while giving feedback, but
 * they stay finite: a tester with a broken client bills you exactly as hard as an
 * attacker would (module 12 §6).
 */
export const limitFor = (plan: Plan, kind: AiCallKind, phase = process.env.PHASE): number =>
  (phase === 'test' ? AI_LIMITS_TEST : AI_LIMITS)[plan][kind];

const COLUMN: Record<AiCallKind, 'tag_limit' | 'chat_limit' | 'rerank_limit'> = {
  tag: 'tag_limit',
  chat: 'chat_limit',
  rerank: 'rerank_limit',
};

/** The live entitlement for a plan, falling back to the constant when unavailable. */
async function limitFromDb(
  supabase: SupabaseClient,
  plan: Plan,
  kind: AiCallKind,
): Promise<number> {
  const { data, error } = await supabase
    .from('plan_features')
    .select('tag_limit, chat_limit, rerank_limit')
    .eq('plan', plan)
    .maybeSingle();

  if (error || !data) return limitFor(plan, kind);

  const value = (data as Record<string, number>)[COLUMN[kind]];
  return typeof value === 'number' ? value : limitFor(plan, kind);
}

/**
 * "Day" is the user's day, not UTC (module 12 §3). A user in Asia/Kolkata whose budget
 * resets at 05:30 local will report it as a bug, and they will be right.
 *
 * `en-CA` formats as YYYY-MM-DD, which is what the `date` column wants.
 */
export function localDay(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // An invalid timezone in a profile must not take the feature down with it.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

/**
 * When the allowance comes back, phrased for a person. A user who knows when it resets
 * waits; one who does not files a support message (module 12 §5).
 */
export function resetLabel(timezone: string, now: Date = new Date()): string {
  try {
    const zoneName =
      new Intl.DateTimeFormat('en-GB', { timeZone: timezone, timeZoneName: 'short' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? timezone;
    return `midnight ${zoneName}`;
  } catch {
    return 'midnight UTC';
  }
}

interface Guard {
  plan: Plan;
  timezone: string;
  day: string;
  limit: number;
}

async function loadGuard(
  supabase: SupabaseClient,
  userId: string,
  kind: AiCallKind,
): Promise<Guard> {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan, timezone')
    .eq('id', userId)
    .single();
  if (error) throw error;

  const plan = (data?.plan ?? 'free') as Plan;
  const timezone = data?.timezone ?? 'Asia/Kolkata';

  return {
    plan,
    timezone,
    day: localDay(timezone),
    limit: await limitFromDb(supabase, plan, kind),
  };
}

/**
 * Throws before any network call, or consumes one unit of the caller's daily
 * allowance. See 0007_ai_budget.sql for why the check and the increment are one
 * statement rather than two.
 */
export async function assertBudget(userId: string, kind: AiCallKind): Promise<void> {
  const supabase = await createClient();
  const { timezone, day, limit } = await loadGuard(supabase, userId, kind);

  // A zero limit is a feature this plan does not have, which is an upgrade prompt —
  // not a "come back tomorrow" (module 12 §5).
  if (limit <= 0) {
    throw appError(
      'PREMIUM_REQUIRED',
      kind === 'chat'
        ? 'The stylist chat is part of premium.'
        : 'Smarter outfit explanations are part of premium.',
    );
  }

  const { data: granted, error } = await supabase.rpc('reserve_ai_call', {
    p_kind: kind,
    p_limit: limit,
    p_day: day,
  });
  if (error) throw error;

  if (!granted) {
    throw appError(
      'AI_BUDGET_EXCEEDED',
      `You've used today's ${limit} ${LABEL[kind]}. They reset at ${resetLabel(timezone)}.`,
    );
  }
}

const LABEL: Record<AiCallKind, string> = {
  tag: 'photo tags',
  chat: 'stylist messages',
  rerank: 'outfit explanations',
};

/**
 * Called after the model returns. Only accumulates tokens — the call itself was
 * already counted by the reservation, and counting it twice would halve every cap.
 *
 * Never throws: a failed usage write must not turn a successful tagging into an error
 * the user sees. It is logged, and the call it failed to record was already counted.
 */
export async function recordUsage(
  userId: string,
  kind: AiCallKind,
  inTokens: number,
  outTokens: number,
): Promise<void> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();

    const { error } = await supabase.rpc('record_ai_tokens', {
      p_day: localDay(data?.timezone ?? 'Asia/Kolkata'),
      p_in: Math.max(0, Math.round(inTokens)),
      p_out: Math.max(0, Math.round(outTokens)),
    });
    if (error) throw error;
  } catch (e) {
    console.error('[budget] could not record usage', { userId, kind, e });
  }
}

/** Today's usage, for the settings screen and for your own aggregate query (§7). */
export async function getUsage(userId: string, day?: string): Promise<AiUsage> {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .single();

  const on = day ?? localDay(profile?.timezone ?? 'Asia/Kolkata');

  const { data, error } = await supabase
    .from('ai_usage')
    .select('user_id, day, tag_calls, chat_calls, llm_calls, in_tokens, out_tokens')
    .eq('user_id', userId)
    .eq('day', on)
    .maybeSingle();
  if (error) throw error;

  return {
    userId,
    day: on,
    tagCalls: data?.tag_calls ?? 0,
    chatCalls: data?.chat_calls ?? 0,
    llmCalls: data?.llm_calls ?? 0,
    inTokens: data?.in_tokens ?? 0,
    outTokens: data?.out_tokens ?? 0,
  };
}

/** What the settings screen shows next to each number. */
export async function getLimits(userId: string): Promise<Record<AiCallKind, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('plan').eq('id', userId).single();
  const plan = (data?.plan ?? 'free') as Plan;

  const [tag, chat, rerank] = await Promise.all([
    limitFromDb(supabase, plan, 'tag'),
    limitFromDb(supabase, plan, 'chat'),
    limitFromDb(supabase, plan, 'rerank'),
  ]);

  return { tag, chat, rerank };
}
