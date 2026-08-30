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
  serverCache = parsed.data;
  return serverCache;
}

export const isTestPhase = () => serverEnv().PHASE === 'test';
