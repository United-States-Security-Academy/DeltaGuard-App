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
};

/**
 * Data Access Layer: the one place the console decides who you are. Reads the
 * verified JWT claims (set by the custom access token hook). Returns null
 * unless the caller is an active admin or supervisor who has passed MFA
 * (MFA can be switched off for local development only; see ./mfa.ts).
 * src/proxy.ts applies the same rules for redirects, but pages and server
 * actions must call this themselves: the proxy alone is not a security
 * boundary.
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  // Always per request, never prerendered: getClaims() checks the token's
  // expiry against the current time, and callers go on to read "today".
  // (Cache Components flags time reads that aren't behind connection().)
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims) return null;

  const role = userRoleSchema.safeParse(claims.user_role);
  if (!role.success || role.data === 'officer') return null;
  if (claims.employment_status !== 'active') return null;
  if (MFA_REQUIRED && claims.aal !== 'aal2') return null;

  // The token can be up to an hour old: confirm the live profile still says
  // active with the same role, so a suspended or demoted admin loses the
  // console (and its service-role actions) at once. RLS returns the row only
  // while the profile is active.
  if (!(await profileStillMatches(claims.sub, role.data))) return null;

  return { userId: claims.sub, email: claims.email, role: role.data };
}

/** Once per request (keyed by its arguments): requireStaff() runs several times per page. */
const profileStillMatches = cache(async (userId: string, role: UserRole): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('role, employment_status')
    .eq('id', userId)
    .maybeSingle();
  return data?.employment_status === 'active' && data.role === role;
});

/** Admin or supervisor with MFA, or redirect to sign-in. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  // Signed-out visitors never get here (the proxy sends them to /login first),
  // so this is a token that no longer matches the live profile: the proxy
  // clears it on /login?error=not_allowed.
  if (!session) redirect('/login?error=not_allowed');
  return session;
}

/** Admin with MFA, or redirect. */
export async function requireAdmin(): Promise<StaffSession> {
  const session = await requireStaff();
  if (session.role !== 'admin') redirect('/');
  return session;
}
