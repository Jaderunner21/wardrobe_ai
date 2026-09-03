/**
 * What must never leave the building in an error report — module 14 §4, §7. Pure.
 *
 * Sentry's default behaviour is to send whatever context it can find, which is exactly
 * right for a stack trace and exactly wrong for this app. Three things in particular
 * would otherwise ride along in an ordinary 500:
 *
 *   1. `Authorization` and `Cookie` headers — a Supabase session token in an error
 *      report is a working credential sitting in a third-party dashboard.
 *   2. Signed image URLs. They are not just paths: a signed URL IS the permission to
 *      read that photograph, valid for as long as the signature is. An error containing
 *      one is a leaked wardrobe photo.
 *   3. Anything `NEXT_PUBLIC_` that could carry a session, plus the service-role key,
 *      which appears in environment dumps.
 *
 * Separated from the Sentry config so it can be tested without initialising the SDK —
 * this is the code that decides what leaves, and a rule nobody can test is a rule
 * nobody can trust.
 */

/** Header names dropped entirely, compared case-insensitively. */
const DROP_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-goog-api-key', 'apikey']);

/** A Supabase Storage signed URL. The token is the credential. */
const SIGNED_URL = /https?:\/\/\S*?(?:\/object\/sign\/|[?&]token=)\S*/gi;

/** A JWT — Supabase session tokens and the service-role key are both this shape. */
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/** Gemini keys. */
const API_KEY = /AIza[0-9A-Za-z_-]{20,}/g;

export const REDACTED = '[redacted]';

/** Redact anything credential-shaped inside a string, wherever it appears. */
export function scrubString(value: string): string {
  return value
    .replace(SIGNED_URL, REDACTED)
    .replace(JWT, REDACTED)
    .replace(API_KEY, REDACTED);
}

/**
 * Walk an arbitrary structure, redacting as it goes. Depth-limited: a Sentry event can
 * contain a cyclic or very deep object, and an error handler that throws or hangs is
 * worse than no error handler.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;

  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_HEADERS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = scrubValue(v, depth + 1);
  }
  return out;
}

/**
 * The `beforeSend` hook. Returns the event with everything credential-shaped removed,
 * or null to drop it entirely.
 *
 * Typed loosely on purpose: importing Sentry's `Event` here would drag the SDK into the
 * test run, and this function's whole value is being testable without it.
 */
export function scrubEvent<T extends Record<string, unknown>>(event: T): T {
  return scrubValue(event) as T;
}
