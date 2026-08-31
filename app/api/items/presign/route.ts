/**
 * POST /api/items/presign — module 04 §3, §4.
 *
 * Validates quota, hash and size, then hands back a signed upload token per file. The
 * browser uploads straight to storage; no image byte ever passes through this
 * function, so its duration is constant regardless of file size.
 *
 * Rejecting here is a courtesy, not the guarantee: a free user at 25 items fails in a
 * second rather than after uploading 20 photos. The DB trigger is what actually
 * enforces the cap, and the partial unique index is what actually enforces dedupe.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { objectPath, signedUploadUrl, thumbPathFor } from '@/lib/storage';
import { FREE_ITEM_CAP } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * A correctly processed 800px WebP is never near 500 KB. A larger one means the
 * client-side pipeline was bypassed, which is the case this limit exists to catch.
 */
const MAX_BYTES = 500_000;

const bodySchema = z.object({
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'Expected a lowercase sha-256 hex digest.'),
  bytes: z
    .number()
    .int()
    .positive()
    .max(MAX_BYTES, 'Image was not compressed client-side.'),
  contentType: z.literal('image/webp'),
});

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { contentHash } = await parseBody(request, bodySchema);
  const supabase = await createClient();

  const [{ data: profile, error: profileError }, { data: existing, error: dupeError }] =
    await Promise.all([
      supabase.from('profiles').select('plan').eq('id', user.id).single(),
      // Binned items keep their hash but not their claim on the wardrobe: re-uploading
      // something you threw away has to work, so only live rows count as duplicates.
      supabase
        .from('items')
        .select('id')
        .eq('content_hash', contentHash)
        .is('deleted_at', null)
        .maybeSingle(),
    ]);

  if (profileError) throw profileError;
  if (dupeError) throw dupeError;
  if (!profile) throw appError('NOT_FOUND', 'No profile for this account.');

  if (existing) {
    // The client can offer "you already have this" and link straight to it.
    throw appError('DUPLICATE_ITEM', undefined, { itemId: existing.id });
  }

  if (profile.plan === 'free') {
    // Drafts count — their bytes are already uploaded. Binned items do not.
    const { count, error } = await supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);
    if (error) throw error;
    if ((count ?? 0) >= FREE_ITEM_CAP) throw appError('ITEM_QUOTA_EXCEEDED');
  }

  const itemId = crypto.randomUUID();
  const storagePath = objectPath(user.id, itemId);
  const thumbPath = thumbPathFor(user.id, itemId);

  const [main, thumb] = await Promise.all([
    signedUploadUrl(storagePath),
    signedUploadUrl(thumbPath),
  ]);

  return ok({
    itemId,
    storagePath,
    thumbPath,
    uploadToken: main.token,
    thumbUploadToken: thumb.token,
  });
});
