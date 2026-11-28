import 'server-only';

import { type UserRole, userRoleSchema } from '@deltaguard/shared';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';

import { MFA_REQUIRED } from './mfa';
import { createClient } from './supabase/server';

export type StaffSession = {
  userId: string;
  email: string | undefined;
  role: Exclude<UserRole, 'officer'>;
  /** Unix seconds of the last TOTP verification (null if MFA is switched off in dev). */
  mfaAt: number | null;
};

/** A console session ends this long after the password sign-in, however active. */
export const SESSION_MAX_HOURS = 12;
/** Sensitive actions need a TOTP code entered within this many minutes. */
export const REAUTH_MINUTES = 10;

type Amr = { method?: unknown; timestamp?: unknown }[];

/** Unix seconds of the latest `method` entry in the JWT's amr claim. */
function amrTime(amr: unknown, method?: string): number | null {
  if (!Array.isArray(amr)) return null;
  const times = (amr as Amr)
    .filter((a) => (method ? a.method === method : true))
    .map((a) => (typeof a.timestamp === 'number' ? a.timestamp : null))
    .filter((t): t is number => t !== null);
  if (times.length === 0) return null;
  return method ? Math.max(...times) : Math.min(...times);
}

export type StaffCheck =
  | { ok: true; session: StaffSession }
  | { ok: false; reason: 'signed_out' | 'not_allowed' | 'expired' };

/**
 * Data Access Layer: the one place the console decides who you are, once per
 * request. Reads the verified JWT claims (custom access token hook). Allowed:
 * an active admin or supervisor who has passed MFA (aal2; dev-only switch in
 * ./mfa.ts), whose live profile still matches the token, and whose sign-in is
 * less than SESSION_MAX_HOURS old. src/proxy.ts only redirects; every page,
 * server action and route handler calls this itself.
 */
export const checkStaff = cache(async (): Promise<StaffCheck> => {
  // Always per request: getClaims() checks expiry against the current time.
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims) return { ok: false, reason: 'signed_out' };

  const role = userRoleSchema.safeParse(claims.user_role);
  if (!role.success || role.data === 'officer') return { ok: false, reason: 'not_allowed' };
  if (claims.employment_status !== 'active') return { ok: false, reason: 'not_allowed' };
  if (MFA_REQUIRED && claims.aal !== 'aal2') return { ok: false, reason: 'not_allowed' };

  // Absolute session lifetime, from the first sign-in factor (refreshing the
  // token doesn't extend it).
  const signedInAt = amrTime(claims.amr);
  if (signedInAt !== null && Date.now() / 1000 - signedInAt > SESSION_MAX_HOURS * 3600) {
    return { ok: false, reason: 'expired' };
  }

  // The token can be up to an hour old: the live profile must still say
  // active with the same role, so a suspended or demoted admin loses the
  // console (and its service-role actions) at once.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, employment_status')
    .eq('id', claims.sub)
    .maybeSingle();
  if (profile?.employment_status !== 'active' || profile.role !== role.data) {
    return { ok: false, reason: 'not_allowed' };
  }

  return {
    ok: true,
    session: {
      userId: claims.sub,
      email: claims.email,
      role: role.data,
      mfaAt: amrTime(claims.amr, 'totp'),
    },
  };
});

/** The staff session, or null. */
export async function getStaffSession(): Promise<StaffSession | null> {
  const check = await checkStaff();
  return check.ok ? check.session : null;
}

/** Admin or supervisor with MFA, or redirect to sign-in. */
export async function requireStaff(): Promise<StaffSession> {
  const check = await checkStaff();
  // /login?error=... makes the proxy clear the session cookies first.
  if (!check.ok) redirect(`/login?error=${check.reason === 'expired' ? 'expired' : 'not_allowed'}`);
  return check.session;
}

/** Admin with MFA, or redirect. */
export async function requireAdmin(): Promise<StaffSession> {
  const session = await requireStaff();
  if (session.role !== 'admin') redirect('/');
  return session;
}

/** Whether the staff member entered a TOTP code within REAUTH_MINUTES. */
export function hasRecentMfa(session: StaffSession): boolean {
  if (!MFA_REQUIRED) return true;
  return session.mfaAt !== null && Date.now() / 1000 - session.mfaAt <= REAUTH_MINUTES * 60;
}

/** Where to confirm identity, coming back to `next` (a path on this site). */
export function reauthUrl(next: string): string {
  return `/reauth?${new URLSearchParams({ next })}`;
}

/**
 * For sensitive server actions (role changes, terminations, device resets):
 * null when the code was entered recently, else the result asking for it.
 */
export function reauthRequired(
  session: StaffSession,
  next: string,
): { ok: false; message: string; reauthUrl: string } | null {
  if (hasRecentMfa(session)) return null;
  return {
    ok: false,
    message: 'For your security, confirm it’s you with your authenticator code, then try again.',
    reauthUrl: reauthUrl(next),
  };
}
