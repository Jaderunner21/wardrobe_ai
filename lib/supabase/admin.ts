/**
 * Service-role client — BYPASSES RLS ENTIRELY (module 03).
 *
 * Used in exactly three places in the whole codebase:
 *   1. account deletion            (app/api/account/route.ts)
 *   2. the Razorpay webhook        (module 13, PROD)
 *   3. the cron worker             (PROD)
 *
 * If you reach for it anywhere else, the answer is that RLS is misconfigured.
 */
import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env, serverEnv } from '@/lib/env';

export const createAdminClient = () =>
  createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
