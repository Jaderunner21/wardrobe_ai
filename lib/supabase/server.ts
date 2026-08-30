/**
 * Server client — anon key plus the user's session, RLS applies (module 03).
 * Use from React Server Components, route handlers and server actions.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** The signed-in user, or null. Never throws. */
export async function getUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/** The signed-in user, or an UNAUTHENTICATED AppError. For route handlers. */
export async function requireUser() {
  const user = await getUser();
  if (!user) {
    const { appError } = await import('@/lib/errors');
    throw appError('UNAUTHENTICATED');
  }
  return user;
}
