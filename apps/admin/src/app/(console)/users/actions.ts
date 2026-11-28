'use server';

import {
  changeRoleSchema,
  inviteUserSchema,
  resetDeviceSchema,
  setEmploymentStatusSchema,
} from '@deltaguard/shared';
import { refresh } from 'next/cache';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { recordAudit } from '@/lib/audit';
import { reauthRequired, requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logFailure, publicMessage } from '@/lib/server-errors';

// Every action re-checks that the caller is an admin with MFA (requireAdmin):
// server actions are public HTTP endpoints, so the page being admin-only is
// not enough. Profile and device changes go through the admin's own session,
// so RLS and the database guard triggers apply. The service role client is
// used only for Auth admin APIs that have no RLS equivalent.

/** Long enough to be permanent; lifted again with 'none' on reactivation. */
const BAN_FOREVER = '876000h';

export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = inviteUserSchema.safeParse({
    full_name: formData.get('full_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    role: formData.get('role'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const { full_name, email, phone, role } = parsed.data;

  // Rate limit (30 an hour per admin) with the admin's own session, before
  // anything is sent.
  const supabase = await createClient();
  const limit = await supabase.rpc('enforce_rate_limit', { p_action: 'invite' });
  if (limit.error) {
    return {
      ok: false,
      message:
        limit.error.code === 'DG429'
          ? 'Too many invites in the last hour. Try again later.'
          : 'You are not allowed to invite users.',
    };
  }

  const admin = createAdminClient();
  // Supabase Auth hands the email to the send-email Edge Function (Send Email
  // hook, Resend), which links to /auth/accept on this console.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
  });
  if (error || !data.user) {
    if (error?.code === 'email_exists' || error?.status === 422) {
      return { ok: false, message: 'Someone with this email already has an account.' };
    }
    logFailure('invite user', error);
    return { ok: false, message: 'The invite could not be sent. Try again.' };
  }

  // The on_auth_user_created trigger already made a profile (role 'officer').
  // Setting the role on the profile makes the profiles_sync_app_metadata
  // trigger write role + employment_status into app_metadata, which is what
  // the access token hook reads. Writing app_metadata directly instead would
  // leave profiles out of sync.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ full_name, phone: phone ?? null, role })
    .eq('id', data.user.id);

  if (profileError) {
    // Don't leave a half-created account behind.
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, message: `The invite was cancelled. ${publicMessage(profileError)}` };
  }

  await recordAudit(supabase, 'user_invited', { type: 'user', id: data.user.id }, { email, role });

  refresh();
  return { ok: true, message: `Invite sent to ${email} as ${role}.` };
}

export async function changeRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const reauth = reauthRequired(me, '/users');
  if (reauth) return reauth;

  const parsed = changeRoleSchema.safeParse({
    user_id: formData.get('user_id'),
    role: formData.get('role'),
  });
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.user_id === me.userId) {
    return { ok: false, message: "You can't change your own role." };
  }

  // The database trigger also signs the user out everywhere so their next
  // token carries the new role.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: parsed.data.role })
    .eq('id', parsed.data.user_id)
    .select('id');
  if (error) return failed(error);
  if (!data.length) return { ok: false, message: 'User not found.' };

  refresh();
  return { ok: true, message: `Role changed to ${parsed.data.role}. They have been signed out.` };
}

export async function setEmploymentStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  const reauth = reauthRequired(me, '/users');
  if (reauth) return reauth;

  const parsed = setEmploymentStatusSchema.safeParse({
    user_id: formData.get('user_id'),
    employment_status: formData.get('employment_status'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const { user_id, employment_status } = parsed.data;
  if (user_id === me.userId) {
    return { ok: false, message: "You can't change your own employment status." };
  }

  const supabase = await createClient();

  // 1. Profile: RLS stops them reading anything, and the trigger deletes all
  //    their sessions (signed out everywhere).
  const { data, error } = await supabase
    .from('profiles')
    .update({ employment_status })
    .eq('id', user_id)
    .select('id');
  if (error) return failed(error);
  if (!data.length) return { ok: false, message: 'User not found.' };

  const problems: string[] = [];
  const active = employment_status === 'active';

  // 2. Devices: revoke the registered phone so it has to be re-approved.
  if (!active) {
    const { error: deviceError } = await supabase
      .from('user_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user_id)
      .is('revoked_at', null);
    if (deviceError) problems.push('devices');
  }

  // 3. Auth ban: blocks signing in again at all. Lifted on reactivation.
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(user_id, {
    ban_duration: active ? 'none' : BAN_FOREVER,
  });
  if (banError) problems.push('sign-in block');

  refresh();
  if (problems.length) {
    return {
      ok: false,
      message: `Status set to ${employment_status}, but some steps failed (${problems.join('; ')}). Try again.`,
    };
  }
  return {
    ok: true,
    message: active
      ? 'Reactivated. They can sign in again.'
      : `Marked ${employment_status}. Signed out everywhere, devices revoked, sign-in blocked.`,
  };
}

export async function resetDevice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const reauth = reauthRequired(me, '/users');
  if (reauth) return reauth;

  const parsed = resetDeviceSchema.safeParse({ user_id: formData.get('user_id') });
  if (!parsed.success) return invalid(parsed.error);

  // Revoking the active device lets the officer register a new phone.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', parsed.data.user_id)
    .is('revoked_at', null)
    .select('id');
  if (error) return failed(error);

  refresh();
  return data.length
    ? { ok: true, message: 'Device reset. They can register a new phone.' }
    : { ok: true, message: 'No active device to reset.' };
}
