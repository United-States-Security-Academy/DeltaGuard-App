import type { CookieOptions } from '@supabase/ssr';

/** The session cookie lasts at most this long (matches SESSION_MAX_HOURS in lib/auth.ts). */
export const SESSION_COOKIE_MAX_AGE = 12 * 60 * 60;

/**
 * Supabase session cookies: httpOnly (JavaScript, including any injected
 * script, can't read the refresh token), Secure in production, SameSite=Lax,
 * and at most 12 hours (@supabase/ssr would otherwise set 400 days). The
 * browser gets only short-lived access tokens, from /auth/token.
 */
export function hardenCookieOptions(options: CookieOptions | undefined): CookieOptions {
  const removing = options?.maxAge === 0;
  return {
    ...options,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: removing ? 0 : SESSION_COOKIE_MAX_AGE,
  };
}
