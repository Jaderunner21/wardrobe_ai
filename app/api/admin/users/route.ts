/**
 * GET /api/admin/users — everyone with an account.
 *
 * Emails live in `auth.users`, which no ordinary client can read, so this is one of the
 * few places the service-role client is legitimate — gated by `requireAdmin()` before
 * the key is ever touched.
 */
import { handle, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';

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
}

interface ProfileSummary {
  id: string;
  display_name: string | null;
  plan: string;
  is_admin: boolean;
  item_count: number;
  city: string | null;
  created_at: string;
}

export const GET = handle(async () => {
  await requireAdmin();
  const admin = createAdminClient();

  const [{ data: authUsers, error: authError }, { data: profiles, error: profileError }] =
    await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
      admin.from('profiles').select('id, display_name, plan, is_admin, item_count, city, created_at'),
    ]);

  if (authError) throw authError;
  if (profileError) throw profileError;

  const byId = new Map(
    ((profiles ?? []) as unknown as ProfileSummary[]).map((p) => [p.id, p]),
  );

  const users: AdminUserRow[] = (authUsers?.users ?? []).map((u) => {
    const profile = byId.get(u.id);
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
    };
  });

  users.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return ok({ users });
});
