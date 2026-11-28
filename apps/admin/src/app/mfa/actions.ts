'use server';

import { totpCodeSchema } from '@deltaguard/shared';
import { z } from 'zod';

import { logFailure } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

// MFA runs on the server: the session cookies are httpOnly, and Supabase
// writes the upgraded (aal2) session into them when the code is verified.
// These actions only need a signed-in, active admin or supervisor (aal1):
// they are how such a user reaches aal2.

export type MfaStart =
  | { kind: 'enroll'; factorId: string; qrCode: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; message: string };

async function signedInStaff() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const staff =
    claims &&
    (claims.user_role === 'admin' || claims.user_role === 'supervisor') &&
    claims.employment_status === 'active';
  return staff ? supabase : null;
}

/** The verified factor to check, or a new TOTP enrollment (QR code + key). */
export async function startMfa(): Promise<MfaStart> {
  const supabase = await signedInStaff();
  if (!supabase) return { kind: 'error', message: 'Sign in again.' };

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    logFailure('list MFA factors', error);
    return { kind: 'error', message: 'Couldn’t load two-factor settings. Try again.' };
  }
  const verified = data.totp.find((f) => f.status === 'verified');
  if (verified) return { kind: 'verify', factorId: verified.id };

  // Clear half-finished enrollments from earlier attempts.
  for (const f of data.all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified')) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const enrolled = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'DeltaGuard Admin',
  });
  if (enrolled.error) {
    logFailure('enroll MFA', enrolled.error);
    return { kind: 'error', message: 'Couldn’t start two-factor setup. Try again.' };
  }
  return {
    kind: 'enroll',
    factorId: enrolled.data.id,
    qrCode: enrolled.data.totp.qr_code,
    secret: enrolled.data.totp.secret,
  };
}

/** Checks a 6-digit code; on success the session cookie is upgraded to aal2. */
export async function verifyMfa(
  factorId: string,
  code: string,
): Promise<{ ok: boolean; message: string }> {
  const parsedId = z.uuid().safeParse(factorId);
  const parsedCode = totpCodeSchema.safeParse(code);
  if (!parsedId.success) return { ok: false, message: 'Reload the page and try again.' };
  if (!parsedCode.success) return { ok: false, message: parsedCode.error.issues[0]!.message };

  const supabase = await signedInStaff();
  if (!supabase) return { ok: false, message: 'Sign in again.' };
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsedId.data,
    code: parsedCode.data,
  });
  if (error) return { ok: false, message: 'That code did not work. Try the next one.' };
  return { ok: true, message: 'Verified.' };
}
