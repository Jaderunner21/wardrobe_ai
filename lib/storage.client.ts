'use client';

/**
 * The browser half of the storage boundary (module 04 §3).
 *
 * `lib/storage.ts` is server-only, and the whole point of the signed-upload design is
 * that the browser talks to the provider directly — no image byte passes through a
 * function. So provider knowledge on the client lands here, and nowhere else: these
 * two files are the entire cost of the R2 migration at ~900 accounts.
 *
 * `scripts/check-storage-boundary.sh` fails the build if a third file learns the
 * provider.
 */
import { createClient } from '@/lib/supabase/client';

export const BUCKET = 'items';

/** Uploads one blob against a token from POST /api/items/presign. */
export async function uploadToSignedPath(path: string, token: string, blob: Blob): Promise<void> {
  const { error } = await createClient()
    .storage.from(BUCKET)
    .uploadToSignedUrl(path, token, blob, { contentType: 'image/webp' });
  if (error) throw error;
}
