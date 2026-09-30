/**
 * PATCH  /api/admin/users/[id] — change a plan, grant/revoke admin, move a user between
 *                                 module 19 §7's recommendation arms, rename, change
 *                                 city, set a new password, or ban / unban
 * DELETE /api/admin/users/[id] — remove someone from the wardrobe entirely
 *
 * Deletion here is the same two-step as a user deleting their own account (module 03
 * §6): stored images first, then the auth row, which cascades every app table. Storage
 * first, because an orphaned object is recoverable and an orphaned row is not.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireAdmin } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteObjects, listUserObjects } from '@/lib/storage';
import { assignmentOf, toFlags } from '@/lib/flags';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    plan: z.enum(['free', 'premium']).optional(),
    isAdmin: z.boolean().optional(),
    /** null clears the override and returns the user to the deterministic default. */
    aiEngine: z.boolean().nullable().optional(),
    displayName: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).nullable().optional(),
    password: z.string().min(8).max(72).optional(),
    /** Banned accounts cannot sign in; existing sessions end when their token expires. */
    banned: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change.' });

export const PATCH = handle(async (request: Request, context: Context) => {
  const admin = await requireAdmin();
  const { id } = await context.params;
  const patch = await parseBody(request, patchSchema);

  // Locking yourself out is a support ticket you cannot file from inside the product.
  if (id === admin.id && (patch.isAdmin === false || patch.banned === true)) {
    throw appError('VALIDATION_FAILED', 'You cannot lock yourself out.');
  }

  const client = createAdminClient();

  // Auth-side changes go through the auth admin API, not the profiles table.
  if (patch.password !== undefined || patch.banned !== undefined) {
    const { error } = await client.auth.admin.updateUserById(id, {
      ...(patch.password !== undefined ? { password: patch.password } : {}),
      ...(patch.banned !== undefined ? { ban_duration: patch.banned ? '876000h' : 'none' } : {}),
    });
    if (error) throw appError('VALIDATION_FAILED', error.message);
  }

  const row: Record<string, unknown> = {};
  if (patch.plan) row.plan = patch.plan;
  if (patch.isAdmin !== undefined) row.is_admin = patch.isAdmin;
  if (patch.displayName !== undefined) row.display_name = patch.displayName || null;
  if (patch.city !== undefined) row.city = patch.city || null;

  /**
   * Merged, not replaced: `flags` is one jsonb object, and the next flag added here must
   * not be wiped by a write that only meant to move someone between arms.
   */
  if (patch.aiEngine !== undefined) {
    const { data: current } = await client
      .from('profiles')
      .select('flags')
      .eq('id', id)
      .maybeSingle();

    const flags = { ...toFlags(current?.flags) };
    if (patch.aiEngine === null) delete flags.aiRecommendations;
    else flags.aiRecommendations = patch.aiEngine;
    row.flags = flags;
  }

  const columns = 'id, plan, is_admin, flags';
  const { data, error } = Object.keys(row).length
    ? await client.from('profiles').update(row).eq('id', id).select(columns).maybeSingle()
    : await client.from('profiles').select(columns).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw appError('NOT_FOUND');

  const assignment = assignmentOf(data.id, toFlags(data.flags));

  return ok({
    user: {
      id: data.id,
      plan: data.plan,
      isAdmin: data.is_admin,
      aiEngine: assignment.enabled,
      aiEngineSource: assignment.source,
    },
  });
});

export const DELETE = handle(async (_request: Request, context: Context) => {
  const admin = await requireAdmin();
  const { id } = await context.params;

  if (id === admin.id) {
    throw appError('VALIDATION_FAILED', 'Delete your own account from Settings instead.');
  }

  const client = createAdminClient();

  // Images first, through lib/storage.ts like everything else — the service-role client
  // is handed in because this is somebody else's prefix, not the caller's.
  let paths: string[] = [];
  try {
    paths = await listUserObjects(id, client);
    await deleteObjects(paths, client);
  } catch (e) {
    // A failed object delete leaves quota behind; a failed row delete leaves a ghost
    // account. Log the first, never let it block the second.
    console.error('[admin] storage delete failed', { id, e });
  }

  const { error } = await client.auth.admin.deleteUser(id);
  if (error) throw error;

  return ok({ deleted: true, objectsRemoved: paths.length });
});
