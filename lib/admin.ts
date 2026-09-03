/**
 * The admin boundary.
 *
 * Two rules, and the second is the one that matters:
 *
 *   1. `profiles.is_admin` says who. It is set in SQL, never through the app — there is
 *      no "make me an admin" path to abuse.
 *   2. Every admin route calls `requireAdmin()` FIRST, before touching the service-role
 *      client. That client bypasses RLS entirely (module 03), so the check has to be the
 *      thing that gates it, not a UI that hides the link.
 */
import 'server-only';
import { appError } from '@/lib/errors';
import { createClient, requireUser } from '@/lib/supabase/server';

export interface AdminUser {
  id: string;
  isAdmin: true;
}

export async function requireAdmin(): Promise<AdminUser> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;

  // FORBIDDEN, not NOT_FOUND: the caller is a real signed-in user who may not do this.
  if (!data?.is_admin) throw appError('FORBIDDEN', 'That area is for administrators.');

  return { id: user.id, isAdmin: true };
}

/** Same check, for a page that should redirect rather than throw. */
export async function isAdmin(): Promise<boolean> {
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}
