import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { MFA_REQUIRED } from './lib/mfa';
import { contentSecurityPolicy, createNonce, staticSecurityHeaders } from './lib/security-headers';
import { hardenCookieOptions } from './lib/supabase/cookies';
import { supabaseEnv } from './lib/supabase/env';

// Next.js 16 renamed middleware to "proxy". This runs before every page and
// route handler: it refreshes the Supabase session cookie, sets the security
// headers (a fresh CSP nonce per response) and redirects based on the JWT.
// It is a convenience layer for redirects ONLY: pages, server actions and
// route handlers check access themselves through src/lib/auth.ts.

/** Reachable without signing in. */
const PUBLIC_PATHS = ['/login', '/auth/accept', '/auth/confirm'];
/** Reachable by any signed-in user, including officers (setting a password from an invite). */
const ANY_USER_PATHS = ['/auth/accept', '/auth/confirm', '/auth/set-password'];
const ADMIN_ONLY_PATHS = ['/users', '/sites/new'];
/** /login?error=... values that mean "sign this session out first". */
const SIGN_OUT_ERRORS = new Set(['not_allowed', 'expired']);

const matches = (pathname: string, paths: string[]) =>
  paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce);

  // Next.js reads the nonce from the request's CSP header and puts it on its
  // own scripts; the root layout reads x-nonce for the theme script.
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);
    return NextResponse.next({ request: { headers } });
  };
  const secure = <T extends NextResponse>(res: T): T => {
    res.headers.set('Content-Security-Policy', csp);
    for (const [key, value] of staticSecurityHeaders()) res.headers.set(key, value);
    return res;
  };

  let response = next();

  const supabase = createServerClient(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, hardenCookieOptions(options)),
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
    return secure(redirect);
  };

  if (!claims) {
    return matches(pathname, PUBLIC_PATHS) ? secure(response) : redirectTo('/login');
  }

  // A page's check (lib/auth.ts) found the session no longer allowed: the
  // profile changed (suspended, terminated, role) or the 12-hour session limit
  // passed. Pages can't write cookies, so the sign-out happens here; the login
  // page then explains why instead of bouncing back to "/".
  if (
    pathname === '/login' &&
    SIGN_OUT_ERRORS.has(request.nextUrl.searchParams.get('error') ?? '')
  ) {
    await supabase.auth.signOut({ scope: 'local' });
    return secure(response);
  }

  if (matches(pathname, ANY_USER_PATHS)) {
    return secure(response);
  }

  // Officers (and anyone suspended, terminated or without a role claim) are
  // signed out of the console and sent to the login page.
  const isStaff = claims.user_role === 'admin' || claims.user_role === 'supervisor';
  if (!isStaff || claims.employment_status !== 'active') {
    await supabase.auth.signOut({ scope: 'local' });
    return redirectTo('/login', '?error=not_allowed');
  }

  // Staff must finish MFA (aal2) before seeing anything else
  // (unless switched off for local development; see lib/mfa.ts).
  if (MFA_REQUIRED && claims.aal !== 'aal2') {
    return pathname === '/mfa' ? secure(response) : redirectTo('/mfa');
  }

  if (pathname === '/login' || pathname === '/mfa') {
    return redirectTo('/');
  }

  if (matches(pathname, ADMIN_ONLY_PATHS) && claims.user_role !== 'admin') {
    return redirectTo('/');
  }

  return secure(response);
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation (next.config.ts
    // sets the non-CSP security headers on those).
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
