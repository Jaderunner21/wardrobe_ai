/**
 * GET /callback — the landing point for both sign-in methods (module 03 §1).
 *
 *   OAuth and PKCE magic links arrive with `?code=`
 *   Email OTP links arrive with `?token_hash=&type=`
 *
 * Either way: establish the session, then return the user to the path they were
 * trying to reach before being bounced to /login.
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

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
    if (!error) return NextResponse.redirect(new URL(next, origin));
    return failed(origin, error.message);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
    return failed(origin, error.message);
  }

  return failed(origin, 'That sign-in link is incomplete.');
}

function failed(origin: string, message: string) {
  const url = new URL('/login', origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}
