/**
 * The ONLY file that knows which provider is in use (module 04).
 *
 * Nothing outside this file may import the Supabase storage client. That rule is the
 * entire cost of the future R2 migration: the database stores *paths*, never URLs, and
 * the columns are called `storage_path` / `thumb_path` rather than anything
 * provider-specific, so the swap at ~900 accounts is this file plus a bucket copy.
 */
import 'server-only';
import { createClient } from '@/lib/supabase/server';

export const BUCKET = 'items';

/**
 * PATH LAYOUT — `items/{userId}/{itemId}.webp`, and note the `items/` is part of the
 * object name INSIDE the bucket, not the bucket name being repeated by accident.
 *
 * The storage policies check `(storage.foldername(name))[2] = auth.uid()::text`, and
 * Postgres arrays are 1-indexed: for the name `items/{userId}/{file}` that array is
 * `{items, userId}`, so element 2 is the user id. Strip the prefix and element 2 is
 * null, which fails the policy for everyone. Module 04 says to verify this index
 * against a real path before trusting it — this is that verification, written down.
 */
export const objectPath = (userId: string, itemId: string) => `${BUCKET}/${userId}/${itemId}.webp`;
export const thumbPathFor = (userId: string, itemId: string) =>
  `${BUCKET}/${userId}/${itemId}_t.webp`;
export const userPrefix = (userId: string) => `${BUCKET}/${userId}`;

/** Generous for a bulk upload on a slow connection, worthless by the time a leaked one is found. */
export const UPLOAD_TOKEN_TTL_SECONDS = 60 * 60 * 2;

/** Export links live 24h (module 03 §5). */
export const EXPORT_URL_TTL_SECONDS = 60 * 60 * 24;

const storage = async () => (await createClient()).storage.from(BUCKET);

/**
 * A token the browser uploads straight to storage with, so the function never sees
 * image bytes and its duration is constant regardless of file size (module 04 §3).
 */
export async function signedUploadUrl(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await (await storage()).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error('could not sign upload');
  return { path, token: data.token };
}

/** One-off signed read URL. Prefer `publicUrlFor` for anything rendered repeatedly. */
export async function signedUrl(path: string, expiresIn = EXPORT_URL_TTL_SECONDS): Promise<string> {
  const { data, error } = await (await storage()).createSignedUrl(path, expiresIn);
  if (error || !data) throw error ?? new Error('could not sign url');
  return data.signedUrl;
}

/**
 * Seconds from now until the day after next UTC midnight — module 04 §6.
 *
 * The bucket is private, so every image needs a signature. A fresh URL per render
 * defeats browser and CDN caching and burns the 5 GB egress allowance. Rounding the
 * expiry to a day boundary means the same path yields the same URL all day, so repeat
 * views cost nothing. Pure, so the boundary arithmetic is unit-tested.
 */
export function secondsUntilDayRoundedExpiry(now: Date = new Date()): number {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.ceil((nextMidnight - now.getTime()) / 1000) + 86_400;
}

/** Day-rounded signed URL: stable for the whole UTC day, therefore cacheable. */
export async function publicUrlFor(path: string): Promise<string> {
  return signedUrl(path, secondsUntilDayRoundedExpiry());
}

/**
 * Batch form of `publicUrlFor`. Generate these in the Server Component that renders
 * the grid — one call for the whole page, never one per image in a client component.
 *
 * Returns a path → URL map. A path that fails to sign is simply absent, so one dead
 * object degrades to a placeholder tile instead of failing the page (module 16 §6.1).
 */
export async function publicUrlsFor(paths: string[]): Promise<Record<string, string>> {
  return signedUrlsFor(paths, secondsUntilDayRoundedExpiry());
}

/** Batch signing at an explicit TTL — the export's 24h links (module 03 §5). */
export async function signedUrlsFor(
  paths: string[],
  expiresIn: number,
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};

  const client = await storage();
  const urls: Record<string, string> = {};

  // createSignedUrls is capped server-side; chunk to stay well inside it.
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const { data, error } = await client.createSignedUrls(paths.slice(i, i + CHUNK), expiresIn);
    if (error || !data) continue;
    for (const entry of data) {
      if (entry.signedUrl && entry.path) urls[entry.path] = entry.signedUrl;
    }
  }
  return urls;
}

/** Removes whatever paths it is given — pass both the main and the thumb. */
export async function deleteObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const client = await storage();

  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const { error } = await client.remove(paths.slice(i, i + CHUNK));
    if (error) throw error;
  }
}

/**
 * Every stored object under a user's prefix, as full paths. Used by account deletion,
 * where storage goes first: if it fails you still have the row and can retry, but if
 * the row goes first the objects are unreachable orphans consuming quota forever.
 */
export async function listUserObjects(userId: string): Promise<string[]> {
  const client = await storage();
  const prefix = userPrefix(userId);
  const found: string[] = [];

  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const entry of data) found.push(`${prefix}/${entry.name}`);
    if (data.length < PAGE) break;
  }
  return found;
}
