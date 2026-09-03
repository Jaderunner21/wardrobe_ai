/**
 * PATCH  /api/account — the profile itself (module 16 §4: Profile and Appearance)
 * DELETE /api/account — module 03 §6.
 *
 * Order matters:
 *   1. list every stored image under items/{userId}/ and delete them
 *   2. delete the auth.users row via the admin client — every app table cascades
 *
 * Storage first. If it fails you still have the row and can retry; if the row is gone
 * first, the objects are unreachable orphans consuming quota forever.
 *
 * No soft delete. This is one of exactly three files allowed to import the
 * service-role client.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteObjects, listUserObjects } from '@/lib/storage';
import { toProfile, type ProfileRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const PROFILE_COLUMNS =
  'id, display_name, avatar_key, city, country, timezone, plan, plan_renews_at, item_count, wardrobe_version, currency, cpw_target, onboarding, preferences, created_at';

/**
 * Only what a person may change about themselves. `plan`, `item_count` and
 * `wardrobe_version` are absent on purpose: they are maintained by billing and by
 * database triggers, and a client that can write them can give itself a paid plan.
 */
const patchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).nullish(),
    city: z.string().trim().min(1).max(80).nullish(),
    country: z.string().trim().length(2).toUpperCase().optional(),
    timezone: z.string().trim().min(1).max(60).optional(),
    /** Module 17 §6 — money is formatted at display time from this. */
    currency: z.string().trim().length(3).toUpperCase().optional(),
    /** A target the user chose, never a verdict on a purchase (module 17 §2). */
    cpwTarget: z.number().positive().max(1_000_000).optional(),
    preferences: z
      .object({
        dateFormat: z.enum(['dmy', 'mdy', 'iso', 'long']).optional(),
        defaultSort: z.enum(['recent', 'least-worn', 'recently-worn', 'cost-per-wear']).optional(),
        wardrobeView: z.enum(['grid', 'list']).optional(),
      })
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update.' });

export const PATCH = handle(async (request: Request) => {
  const user = await requireUser();
  const patch = await parseBody(request, patchSchema);
  const supabase = await createClient();

  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.country !== undefined) row.country = patch.country;
  if (patch.timezone !== undefined) row.timezone = patch.timezone;
  if (patch.currency !== undefined) row.currency = patch.currency;
  if (patch.cpwTarget !== undefined) row.cpw_target = patch.cpwTarget;

  /**
   * Preferences MERGE rather than replace. The Appearance tab sends one control at a
   * time, and a whole-object write would silently reset the other two — the kind of bug
   * that only shows up when a second control exists.
   */
  if (patch.preferences) {
    const { data: current, error } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .single();
    if (error) throw error;

    row.preferences = {
      ...((current?.preferences as Record<string, unknown> | null) ?? {}),
      ...patch.preferences,
    };
  }

  // RLS restricts this to the caller's own row; the id filter is what makes it one row.
  const { data, error } = await supabase
    .from('profiles')
    .update(row)
    .eq('id', user.id)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;

  return ok({ profile: toProfile(data as unknown as ProfileRow) });
});

const bodySchema = z.object({
  confirm: z.literal('DELETE', { message: 'Type DELETE to confirm.' }),
});

export const DELETE = handle(async (request: Request) => {
  const user = await requireUser();
  await parseBody(request, bodySchema);

  // 1. images, with the caller's own session — storage RLS still applies here.
  const objects = await listUserObjects(user.id);
  await deleteObjects(objects);

  // 2. the auth row. Cascades profiles → items, outfits, feedback, everything.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw error;

  return ok({ deleted: true, objectsRemoved: objects.length });
});
