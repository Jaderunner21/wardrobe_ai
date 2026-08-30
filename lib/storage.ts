/**
 * The ONLY file that knows which storage provider is in use (module 01, module 04).
 *
 * The database holds paths, never URLs. Read URLs are generated here, signed and
 * day-rounded so they stay cacheable. Moving from Supabase Storage to Cloudflare R2
 * later is a change to this file, not a migration.
 *
 * L0 provides the paths, listing and deletion that account export and account
 * deletion need (module 03 §5, §6). Module 04 extends it with signed uploads.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const BUCKET = 'items';

/** items/{userId}/{itemId}.webp — the folder index the storage RLS policy relies on. */
export const objectPath = (userId: string, itemId: string) => `${BUCKET}/${userId}/${itemId}.webp`;
export const thumbPath = (userId: string, itemId: string) => `${BUCKET}/${userId}/${itemId}_t.webp`;
export const userPrefix = (userId: string) => `${BUCKET}/${userId}`;

/** Export links live 24h (module 03 §5). Browsing links are day-rounded (module 04 §6). */
export const EXPORT_URL_TTL_SECONDS = 60 * 60 * 24;

/**
 * Signed read URLs for many paths at once.
 * Returns a path → URL map; a path that fails to sign is simply absent, so one dead
 * object degrades to a placeholder tile rather than failing the whole page.
 */
export async function signedUrls(
  supabase: SupabaseClient,
  paths: string[],
  expiresIn: number,
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};

  const urls: Record<string, string> = {};
  // createSignedUrls is capped server-side; chunk to stay well inside it.
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK).map(stripBucket);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, expiresIn);
    if (error || !data) continue;
    for (const entry of data) {
      if (entry.signedUrl && entry.path) urls[`${BUCKET}/${entry.path}`] = entry.signedUrl;
    }
  }
  return urls;
}

/** Every stored object under a user's prefix. Used by account deletion. */
export async function listUserObjects(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const found: string[] = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(userId, { limit: PAGE, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const entry of data) found.push(`${userId}/${entry.name}`);
    if (data.length < PAGE) break;
  }
  return found;
}

/** Paths here are bucket-relative (`{userId}/{itemId}.webp`), as `list` returns them. */
export async function removeObjects(
  supabase: SupabaseClient,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove(paths.slice(i, i + CHUNK).map(stripBucket));
    if (error) throw error;
  }
}

/** The DB stores `items/{userId}/…`; the SDK wants it relative to the bucket. */
const stripBucket = (path: string) =>
  path.startsWith(`${BUCKET}/`) ? path.slice(BUCKET.length + 1) : path;
