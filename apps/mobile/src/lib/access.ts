import { deviceRegistrationSchema, type UserRole } from '@deltaguard/shared';

import { currentPlatform, getOrCreateDeviceId } from './device';
import { supabase } from './supabase';

export type Profile = { id: string; fullName: string | null; role: UserRole };

export type AccessResult =
  | { ok: true; profile: Profile }
  /** Access denied: sign out and show the message. */
  | { ok: false; kind: 'denied'; message: string }
  /** Couldn't reach the server: let the user retry. */
  | { ok: false; kind: 'unreachable'; message: string };

export const ACCESS_MESSAGES = {
  inactive: 'Your account is not active. If you think this is a mistake, contact your supervisor.',
  otherPhone:
    'This account is registered to another phone. Ask an admin to reset your device, then sign in again.',
  deviceReset:
    'Your registered device was reset by an admin. Sign in again to register this phone.',
  unsupported: 'Deltacon Guard only runs on iOS and Android phones.',
} as const;

const denied = (message: string): AccessResult => ({ ok: false, kind: 'denied', message });
const unreachable = (): AccessResult => ({
  ok: false,
  kind: 'unreachable',
  message: "Couldn't check your account. Check your connection and try again.",
});

/**
 * Confirms the signed-in user may use the app on this phone:
 *  1. their profile is readable and active (RLS hides it from inactive users);
 *  2. this phone is their one active registered device.
 * `allowRegister` is true straight after a password sign-in: if they have no
 * active device, this phone is registered. On a normal launch it is false, so
 * a device an admin reset is not silently re-registered.
 * A different active phone is never replaced here: only an admin can reset it
 * (the database blocks users from revoking their own device).
 */
export async function verifyAccess(userId: string, allowRegister: boolean): Promise<AccessResult> {
  const platform = currentPlatform();
  if (!platform) return denied(ACCESS_MESSAGES.unsupported);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, role, employment_status')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) return unreachable();
  if (!profile || profile.employment_status !== 'active') return denied(ACCESS_MESSAGES.inactive);

  const deviceId = await getOrCreateDeviceId();
  const { data: active, error: deviceError } = await supabase
    .from('user_devices')
    .select('id, device_id')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle();
  if (deviceError) return unreachable();

  const result: AccessResult = {
    ok: true,
    profile: { id: profile.id, fullName: profile.full_name, role: profile.role },
  };

  if (active) {
    if (active.device_id !== deviceId) return denied(ACCESS_MESSAGES.otherPhone);
    // Best effort; a failed timestamp update shouldn't lock anyone out.
    await supabase
      .from('user_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', active.id);
    return result;
  }

  if (!allowRegister) return denied(ACCESS_MESSAGES.deviceReset);

  const registration = deviceRegistrationSchema.parse({ device_id: deviceId, platform });
  const { error: insertError } = await supabase
    .from('user_devices')
    .insert({ user_id: userId, ...registration });
  if (insertError) {
    // 23505 = another phone registered first (one active device per user).
    return insertError.code === '23505' ? denied(ACCESS_MESSAGES.otherPhone) : unreachable();
  }
  return result;
}
