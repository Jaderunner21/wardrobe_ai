/**
 * GET  /api/admin/users — everyone with an account (every page of auth.users)
 * POST /api/admin/users — create an account, already confirmed, optionally an admin
 *
 * Emails live in `auth.users`, which no ordinary client can read, so this is one of the
 * few places the service-role client is legitimate — gated by `requireAdmin()` before
 * the key is ever touched.
 */
import { z } from 'zod';
import type { User } from '@supabase/supabase-js';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireAdmin } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignmentOf, toFlags } from '@/lib/flags';

export const dynamic = 'force-dynamic';

export interface AdminUserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  plan: string;
  isAdmin: boolean;
  itemCount: number;
  city: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
  /** AI calls today (tagging + outfit model calls), India time. */
  aiToday: number;
  /** Module 19 §7: which recommendation arm this user is in, and why. */
  aiEngine: boolean;
  aiEngineSource: 'set' | 'default';
}

interface ProfileSummary {
  id: string;
  display_name: string | null;
  plan: string;
  is_admin: boolean;
  item_count: number;
  city: string | null;
  created_at: string;
  flags: Record<string, unknown>;
}

async function allAuthUsers(admin: ReturnType<typeof createAdminClient>): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

export const GET = handle(async () => {
  await requireAdmin();
  const admin = createAdminClient();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const [authUsers, { data: profiles, error: profileError }, { data: usage }] = await Promise.all([
    allAuthUsers(admin),
    admin
      .from('profiles')
      .select('id, display_name, plan, is_admin, item_count, city, created_at, flags'),
    admin.from('ai_usage').select('user_id, tag_calls, llm_calls').eq('day', today),
  ]);
  if (profileError) throw profileError;

  const byId = new Map(((profiles ?? []) as unknown as ProfileSummary[]).map((p) => [p.id, p]));
  const aiById = new Map((usage ?? []).map((u) => [u.user_id, (u.tag_calls ?? 0) + (u.llm_calls ?? 0)]));
  const now = Date.now();

  const users: AdminUserRow[] = authUsers.map((u) => {
    const profile = byId.get(u.id);
    // Unassigned users are bucketed from their id, so the console shows the arm they
    // are actually in rather than a blank for "no flag written yet".
    const assignment = assignmentOf(u.id, toFlags(profile?.flags));
    return {
      id: u.id,
      email: u.email ?? null,
      displayName: profile?.display_name ?? null,
      plan: profile?.plan ?? 'free',
      isAdmin: profile?.is_admin ?? false,
      itemCount: profile?.item_count ?? 0,
      city: profile?.city ?? null,
      createdAt: profile?.created_at ?? u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      banned: Boolean(u.banned_until && new Date(u.banned_until).getTime() > now),
      aiToday: aiById.get(u.id) ?? 0,
      aiEngine: assignment.enabled,
      aiEngineSource: assignment.source,
    };
  });

  users.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return ok({ users });
});

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  name: z.string().trim().max(80).optional(),
  plan: z.enum(['free', 'premium']).optional(),
  isAdmin: z.boolean().optional(),
});

export const POST = handle(async (request: Request) => {
  await requireAdmin();
  const body = await parseBody(request, createSchema);
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: body.name ? { full_name: body.name } : {},
  });
  if (error || !data.user) throw appError('VALIDATION_FAILED', error?.message ?? 'Could not create that account.');

  // The profile row is made by the auth trigger (0006); set what the form asked for.
  const row: Record<string, unknown> = {};
  if (body.plan) row.plan = body.plan;
  if (body.isAdmin) row.is_admin = true;
  if (Object.keys(row).length) {
    const { error: profileError } = await admin.from('profiles').update(row).eq('id', data.user.id);
    if (profileError) throw profileError;
  }

  return ok({ id: data.user.id }, { status: 201 });
});
