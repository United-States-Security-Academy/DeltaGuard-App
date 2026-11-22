import 'server-only';

import { type UserRole, userRoleSchema } from '@deltaguard/shared';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

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

  return { userId: claims.sub, email: claims.email, role: role.data };
}

/** Admin or supervisor with MFA, or redirect to sign-in. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect('/login');
  return session;
}

/** Admin with MFA, or redirect. */
export async function requireAdmin(): Promise<StaffSession> {
  const session = await requireStaff();
  if (session.role !== 'admin') redirect('/');
  return session;
}
