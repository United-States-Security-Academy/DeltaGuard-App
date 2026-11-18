import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { supabaseEnv } from './lib/supabase/env';

// Next.js 16 renamed middleware to "proxy". This runs before every page:
// it refreshes the Supabase session cookie and redirects based on the JWT.
// It is a convenience layer for redirects; pages and server actions still
// check access themselves through src/lib/auth.ts.

/** Reachable without signing in. */
const PUBLIC_PATHS = ['/login', '/auth/accept', '/auth/confirm'];
/** Reachable by any signed-in user, including officers (setting a password from an invite). */
const ANY_USER_PATHS = ['/auth/accept', '/auth/confirm', '/auth/set-password'];
const ADMIN_ONLY_PATHS = ['/users'];

const matches = (pathname: string, paths: string[]) =>
  paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Verifies the JWT and refreshes it if needed. Do not run code between
  // createServerClient and this call.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const { pathname } = request.nextUrl;

  // Redirect while keeping any refreshed/cleared session cookies.
  const redirectTo = (path: string, search = '') => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!claims) {
    return matches(pathname, PUBLIC_PATHS) ? response : redirectTo('/login');
  }

  if (matches(pathname, ANY_USER_PATHS)) {
    return response;
  }

  // Officers (and anyone suspended, terminated or without a role claim) are
  // signed out of the console and sent to the login page.
  const isStaff = claims.user_role === 'admin' || claims.user_role === 'supervisor';
  if (!isStaff || claims.employment_status !== 'active') {
    await supabase.auth.signOut({ scope: 'local' });
    return redirectTo('/login', '?error=not_allowed');
  }

  // Staff must finish MFA (aal2) before seeing anything else.
  if (claims.aal !== 'aal2') {
    return pathname === '/mfa' ? response : redirectTo('/mfa');
  }

  if (pathname === '/login' || pathname === '/mfa') {
    return redirectTo('/');
  }

  if (matches(pathname, ADMIN_ONLY_PATHS) && claims.user_role !== 'admin') {
    return redirectTo('/');
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
