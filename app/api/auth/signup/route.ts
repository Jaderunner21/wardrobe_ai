/**
 * POST /api/auth/signup — create an email + password account, already confirmed.
 *
 * WHY THE ADMIN API. Supabase's built-in mailer sends 2 emails an hour per project, so a
 * confirmation email makes sign-up fail for the third person in any hour. Creating the
 * user with `email_confirm: true` takes email out of onboarding entirely. The trade-off
 * is that the address is not proven to be yours; nothing in the app sends mail to it or
 * trusts it for anything but sign-in, so that is acceptable until custom SMTP is set up
 * (docs/email-smtp.md).
 *
 * It never signs anyone in and never touches an existing account: the browser signs in
 * with the password afterwards, so an existing address with a wrong password still fails.
 */
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(80),
  email: z.string().trim().toLowerCase().email('That email address does not look right.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(72),
});

/** Supabase's wording for "that address already has an account". */
const ALREADY_REGISTERED = /already registered|already been registered|user already exists/i;

/**
 * Best-effort brake on scripted sign-ups: a handful per IP per window, per warm instance.
 * Not a security boundary — serverless instances do not share memory — but it turns a
 * naive loop into a slow one.
 */
const WINDOW_MS = 10 * 60 * 1000;
const PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function throttle(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= PER_WINDOW) {
    throw appError('RATE_LIMITED', 'Too many new accounts from here. Try again in a few minutes.');
  }
  hits.push(now);
  recent.set(ip, hits);
}

export const POST = handle(async (request: Request) => {
  throttle(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown');

  const { name, email, password } = await parseBody(request, bodySchema);
  const admin = createAdminClient();

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // handle_new_user (0006) copies full_name into profiles.display_name.
    user_metadata: { full_name: name },
  });

  if (error) {
    if (error.code === 'email_exists' || ALREADY_REGISTERED.test(error.message)) {
      throw appError('VALIDATION_FAILED', 'That email already has an account. Sign in instead.');
    }
    if (error.code === 'weak_password') {
      throw appError('VALIDATION_FAILED', 'Choose a stronger password.');
    }
    throw appError('VALIDATION_FAILED', error.message);
  }

  return ok({ created: true });
});
