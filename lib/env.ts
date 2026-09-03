/**
 * Environment validation (module 01 — Environment variables).
 *
 * A missing key should crash the build, not surface as a 500 in production at 2am.
 *
 * Only `NEXT_PUBLIC_`-prefixed variables reach the client bundle, so the server half
 * is read lazily through `serverEnv()` — importing this module from a client
 * component must not drag a secret along.
 */
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GEMINI_API_KEY: z.string().min(10).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  SENTRY_DSN: z.string().url().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  /** `test` raises the AI caps and seeds testers premium — module 12, module 15. */
  PHASE: z.enum(['test', 'production']).default('production'),
});

/**
 * Module 13 §5 and its acceptance line: "staging uses test keys — verified by asserting
 * the key prefix at startup."
 *
 * Razorpay test keys start `rzp_test_`, live keys `rzp_live_`. A live key in a preview
 * deployment is a real charge on a real card, which is not a bug found in review — it is
 * one found in someone's bank statement. So the mismatch refuses to boot.
 *
 * Here rather than in `lib/billing.ts` because that module is server-only for its use of
 * `node:crypto`, and this has to run wherever the environment is first read.
 */
export function assertKeyMatchesPhase(keyId: string | undefined, phase: string): void {
  if (!keyId) return; // billing not configured; nothing to get wrong yet

  if (phase !== 'production' && keyId.startsWith('rzp_live_')) {
    throw new Error(
      'A live Razorpay key is configured outside production. That charges real cards. ' +
        'Use rzp_test_ keys everywhere except the production deployment.',
    );
  }
}

/** Whether billing is wired up at all. False through the whole test phase. */
export const billingConfigured = (keyId?: string, keySecret?: string): boolean =>
  Boolean(keyId && keySecret);

function fail(where: string, error: z.ZodError): never {
  const lines = error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid ${where} environment:\n${lines}`);
}

// Next.js inlines `process.env.NEXT_PUBLIC_*` only for literal member access, so
// these cannot be read through a loop.
const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
if (!parsedPublic.success) fail('public', parsedPublic.error);

export const env = parsedPublic.data;

let serverCache: z.infer<typeof serverSchema> | null = null;

export function serverEnv(): z.infer<typeof serverSchema> {
  if (serverCache) return serverCache;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) fail('server', parsed.error);

  /**
   * Module 13 §5, and the only startup check that exists to prevent a charge rather
   * than an outage: a live Razorpay key outside production bills a real card on a
   * preview deployment. Refusing to boot is the correct severity — this is not a
   * warning you notice in a log, it is one you notice in someone's bank statement.
   */
  assertKeyMatchesPhase(parsed.data.RAZORPAY_KEY_ID, parsed.data.PHASE);

  serverCache = parsed.data;
  return serverCache;
}

export const isTestPhase = () => serverEnv().PHASE === 'test';
