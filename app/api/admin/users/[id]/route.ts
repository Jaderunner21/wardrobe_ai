/**
 * PATCH  /api/admin/users/[id] — change a plan, or grant/revoke admin
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

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    plan: z.enum(['free', 'premium']).optional(),
    isAdmin: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change.' });

export const PATCH = handle(async (request: Request, context: Context) => {
  const admin = await requireAdmin();
  const { id } = await context.params;
  const patch = await parseBody(request, patchSchema);

  // Locking yourself out is a support ticket you cannot file from inside the product.
  if (id === admin.id && patch.isAdmin === false) {
    throw appError('VALIDATION_FAILED', 'You cannot remove your own admin access.');
  }

  const row: Record<string, unknown> = {};
  if (patch.plan) row.plan = patch.plan;
  if (patch.isAdmin !== undefined) row.is_admin = patch.isAdmin;

  const client = createAdminClient();
  const { data, error } = await client
    .from('profiles')
    .update(row)
    .eq('id', id)
    .select('id, plan, is_admin')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw appError('NOT_FOUND');

  return ok({ user: { id: data.id, plan: data.plan, isAdmin: data.is_admin } });
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
