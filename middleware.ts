/**
 * Session refresh + route protection (module 03 §3).
 *
 * This follows Supabase's documented `@supabase/ssr` middleware pattern deliberately
 * and exactly. Hand-rolled cookie handling in this stack produces sessions that work
 * locally and expire unpredictably in production.
 *
 * Three rules only:
 *   1. refresh the session cookie on every request
 *   2. signed-out visitors to `/` see the landing page; anywhere else private sends them
 *      to /login, remembering where they were going
 *   3. signed-in users skip the landing page and the sign-in form
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Reachable without a session. Everything else in the app is not. */
const PUBLIC_PATHS = ['/login', '/callback', '/welcome', '/credits', '/api/health', '/api/auth'];

const isPublic = (pathname: string) =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(toSet) {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not put anything between createServerClient and getUser: a slow call here
  // is a session that randomly fails to refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && pathname === '/') {
    // Same URL, landing page content: `/` is the product's front door either way.
    const url = request.nextUrl.clone();
    url.pathname = '/welcome';
    const rewrite = NextResponse.rewrite(url);
    for (const cookie of response.cookies.getAll()) rewrite.cookies.set(cookie);
    return rewrite;
  }

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Return to the originally requested path after sign-in (module 03 acceptance).
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/welcome')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and image files — those never
     * carry a session and paying for a Supabase round trip on each is waste.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
