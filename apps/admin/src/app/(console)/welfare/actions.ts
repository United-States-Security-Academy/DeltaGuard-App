'use server';

import {
  companyWelfarePolicySchema,
  officerWelfareSettingSchema,
  pauseWelfareChecksSchema,
  recordIdSchema,
  siteWelfareSettingsSchema,
  welfarePolicySchema,
} from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { checked, num, text, UNIQUE_VIOLATION } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Admin-only welfare settings. Everything runs with the admin's own session:
// RLS lets only active admins write policies, the guard trigger lets only
// admins change a site's welfare columns, and the pause functions check the
// role themselves.

/** Pause lengths offered in the console (minutes); empty = until resumed. */
const pauseMinutesSchema = z.coerce.number().int().min(5).max(720).nullable();

export async function pauseWelfareChecks(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const minutes = pauseMinutesSchema.safeParse(num(fd, 'minutes'));
  if (!minutes.success) return { ok: false, message: 'Choose how long to pause for.' };
  const parsed = pauseWelfareChecksSchema.safeParse({
    p_shift_id: text(fd, 'shift_id'),
    p_reason: text(fd, 'reason') ?? '',
    p_resume_at:
      minutes.data === null ? null : new Date(Date.now() + minutes.data * 60_000).toISOString(),
  });
  if (!parsed.success) {
    const state = invalid(parsed.error);
    return { ok: false, message: state?.fieldErrors?.p_reason ?? 'Check the pause details.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('pause_welfare_checks', {
    p_shift_id: parsed.data.p_shift_id,
    p_reason: parsed.data.p_reason,
    p_resume_at: parsed.data.p_resume_at ?? undefined,
  });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Welfare checks paused for this shift.' };
}

export async function resumeWelfareChecks(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'shift_id') });
  if (!id.success) return { ok: false, message: 'Unknown shift.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('resume_welfare_checks', { p_shift_id: id.data.id });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Welfare checks resumed.' };
}

export async function saveSiteWelfare(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = siteWelfareSettingsSchema.safeParse({
    site_id: text(fd, 'site_id'),
    welfare_policy_id: text(fd, 'welfare_policy_id'),
    welfare_checks_enabled: checked(fd, 'welfare_checks_enabled'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const { site_id, ...values } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sites')
    .update(values)
    .eq('id', site_id)
    .select('id');
  if (error) return failed(error);
  if (!data.length) return { ok: false, message: 'The site could not be saved.' };
  refresh();
  return { ok: true, message: 'Saved.' };
}

export async function setCompanyWelfarePolicy(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = companyWelfarePolicySchema.safeParse({
    welfare_policy_id: text(fd, 'welfare_policy_id'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .update(parsed.data)
    .eq('id', true)
    .select('id');
  if (error) return failed(error);
  if (!data.length) return { ok: false, message: 'The company default could not be saved.' };
  refresh();
  return {
    ok: true,
    message: parsed.data.welfare_policy_id
      ? 'Company default saved. It applies from each officer’s next check or clock-in.'
      : 'No company default: only sites with their own policy have checks.',
  };
}

/** FormData → the policy schema's input (blank optional fields → null). */
function policyInput(fd: FormData) {
  const nightOn = checked(fd, 'night_enabled');
  return {
    name: text(fd, 'name') ?? '',
    min_interval_minutes: num(fd, 'min_interval_minutes'),
    max_interval_minutes: num(fd, 'max_interval_minutes'),
    night_start: nightOn ? text(fd, 'night_start') : null,
    night_end: nightOn ? text(fd, 'night_end') : null,
    night_min_interval_minutes: nightOn ? num(fd, 'night_min_interval_minutes') : null,
    night_max_interval_minutes: nightOn ? num(fd, 'night_max_interval_minutes') : null,
    response_seconds: num(fd, 'response_seconds'),
    alarm_seconds: num(fd, 'alarm_seconds'),
    call_attempts: num(fd, 'call_attempts'),
    call_gap_seconds: num(fd, 'call_gap_seconds'),
    supervisor_alert_after_seconds: (() => {
      const minutes = num(fd, 'supervisor_alert_after_minutes');
      return minutes === null ? null : minutes * 60;
    })(),
    enabled: checked(fd, 'enabled'),
  };
}

function policyError(error: { code?: string; message: string }): ActionState {
  if (error.code === UNIQUE_VIOLATION) {
    return {
      ok: false,
      message: 'A policy with this name already exists.',
      fieldErrors: { name: 'Already used' },
    };
  }
  return failed(error);
}

export async function createWelfarePolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = welfarePolicySchema.safeParse(policyInput(fd));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from('welfare_check_policies').insert(parsed.data);
  if (error) return policyError(error);
  redirect('/welfare/policies');
}

export async function updateWelfarePolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Unknown policy.' };
  const parsed = welfarePolicySchema.safeParse(policyInput(fd));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('welfare_check_policies')
    .update(parsed.data)
    .eq('id', id.data.id)
    .select('id');
  if (error) return policyError(error);
  if (!data.length) return { ok: false, message: 'The policy could not be saved.' };
  refresh();
  return {
    ok: true,
    message: 'Policy saved. Checks already scheduled keep their timings; new ones use these.',
  };
}

/** Only a policy nothing uses can be deleted (otherwise switch it off). */
export async function deleteWelfarePolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Unknown policy.' };
  const supabase = await createClient();
  const [sites, settings] = await Promise.all([
    supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('welfare_policy_id', id.data.id),
    supabase.from('settings').select('welfare_policy_id').maybeSingle(),
  ]);
  if (settings.data?.welfare_policy_id === id.data.id) {
    return { ok: false, message: 'This is the company default. Choose another default first.' };
  }
  if ((sites.count ?? 0) > 0) {
    return {
      ok: false,
      message: `${sites.count} site(s) use this policy. Move them to another policy first, or switch it off.`,
    };
  }
  const { error } = await supabase.from('welfare_check_policies').delete().eq('id', id.data.id);
  if (error) return failed(error);
  redirect('/welfare/policies');
}

/** Assign a policy (or switch checks off, or back to the site's) for chosen officers. */
export async function setOfficerWelfare(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = officerWelfareSettingSchema.safeParse({
    officer_ids: fd.getAll('officer_id').map(String),
    setting: text(fd, 'setting') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the selection.' };
  }
  const { officer_ids, setting } = parsed.data;
  const supabase = await createClient();

  const { error } =
    setting === 'inherit'
      ? await supabase.from('officer_welfare_settings').delete().in('officer_id', officer_ids)
      : await supabase
          .from('officer_welfare_settings')
          .upsert(
            officer_ids.map((officer_id) =>
              setting === 'off'
                ? { officer_id, mode: 'off', policy_id: null }
                : { officer_id, mode: 'policy', policy_id: setting },
            ),
          );
  if (error) return failed(error);
  refresh();
  const who = officer_ids.length === 1 ? 'the officer' : `${officer_ids.length} officers`;
  return {
    ok: true,
    message:
      setting === 'inherit'
        ? `Saved: ${who} follow their site’s policy again.`
        : setting === 'off'
          ? `Saved: no welfare checks for ${who}.`
          : `Saved: ${who} now use this policy. Anyone on duty gets their next check under it.`,
  };
}
