/**
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
import { requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteObjects, listUserObjects } from '@/lib/storage';

export const dynamic = 'force-dynamic';

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
