/**
 * GET /callback — the landing point for both sign-in methods (module 03 §1).
 *
 *   OAuth and PKCE magic links arrive with `?code=`
 *   Email OTP links arrive with `?token_hash=&type=`
 *   The password form arrives with neither — it already has a session
 *
 * Either way: establish the session, then return the user to the path they were
 * trying to reach before being bounced to /login.
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { trackSignupOnce } from '@/lib/events';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  // Only ever redirect to a path on this origin — an open redirect here is a
  // phishing vector that arrives inside our own sign-in email.
  const requested = searchParams.get('next') ?? '/';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Module 14 §1's funnel starts here. Awaited rather than fired and forgotten:
      // this is one row on a rare path, and a signup missing from the denominator is
      // the one loss that makes every other number in the funnel wrong.
      await trackSignupOnce();
      return NextResponse.redirect(new URL(next, origin));
    }
    return failed(origin, error.message);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      await trackSignupOnce();
      return NextResponse.redirect(new URL(next, origin));
    }
    return failed(origin, error.message);
  }

  /**
   * No code and no token_hash. That is the password form, which established the session
   * in the browser and sent the user here so the SERVER sees the cookie — and so that
   * `signup` is still emitted from exactly one file whichever way someone got in
   * (module 14's acceptance).
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await trackSignupOnce();
    return NextResponse.redirect(new URL(next, origin));
  }

  return failed(origin, 'That sign-in link is incomplete.');
}

function failed(origin: string, message: string) {
  const url = new URL('/login', origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}
