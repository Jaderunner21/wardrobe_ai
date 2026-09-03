/**
 * GET /api/insights/retailers — module 18 §4.
 *
 * Reads the `retailer_durability` view, which carries `security_invoker = true` so RLS
 * on `items` applies inside it. Without that flag Postgres 15+ would run the view as
 * its creator and one user could read another's purchase history through it — worth
 * saying out loud, because a view is the easy place to lose row-level security.
 *
 * Returns `[]` rather than an error for a user whose shops all have fewer than three
 * items: nothing to say yet is a normal state, not a failure.
 */
import { handle, ok } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { retailerDurability } from '@/lib/retailers';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireUser();
  const supabase = await createClient();

  return ok({ retailers: await retailerDurability(supabase) });
});
