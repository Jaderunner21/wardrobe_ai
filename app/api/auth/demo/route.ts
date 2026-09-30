/**
 * POST /api/auth/demo — "Explore the demo": signs the visitor into one of the seeded demo
 * wardrobes, server-side, so the shared password never reaches the browser.
 *
 * Sets the session cookie on this response; the client then goes to /callback like
 * every other way in.
 */
import { handle, ok } from '@/lib/api';
import { appError } from '@/lib/errors';
import { serverEnv } from '@/lib/env';
import { randomDemoAccount } from '@/lib/demo';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const POST = handle(async () => {
  const password = serverEnv().DEMO_PASSWORD;
  if (!password) throw appError('NOT_FOUND', 'The demo is not set up on this deployment.');

  const supabase = await createClient();
  const account = randomDemoAccount();
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  if (error) throw appError('INTERNAL', 'The demo wardrobe is unavailable right now.');

  return ok({ name: account.name });
});
