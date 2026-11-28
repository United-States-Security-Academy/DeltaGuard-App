'use server';

import {
  approveTimesheetSchema,
  correctionInstants,
  payPeriodSchema,
  recordIdSchema,
  timesheetCorrectionFormSchema,
} from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin, requireStaff } from '@/lib/auth';
import { json, text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../schedule/data';
import { publicMessage } from '@/lib/server-errors';

// Timesheets: corrections and approval (admins and supervisors), pay periods
// and locking (admins). The database functions enforce the same rules, audit
// corrections and refuse any change inside a locked period.

export async function createPayPeriod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = payPeriodSchema.safeParse({
    starts_on: text(fd, 'starts_on'),
    ends_on: text(fd, 'ends_on'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pay_periods')
    .insert(parsed.data)
    .select('id')
    .single();
  if (error) {
    return {
      ok: false,
      message:
        error.code === '23P01'
          ? 'This period overlaps an existing pay period.'
          : publicMessage(error, 'save'),
    };
  }
  redirect(`/timesheets?period=${data.id}`);
}

export async function deletePayPeriod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const supabase = await createClient();
  const { error } = await supabase.from('pay_periods').delete().eq('id', id.data.id);
  if (error) return failed(error);
  redirect('/timesheets');
}

export async function lockPayPeriod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc('lock_pay_period', { p_period_id: id.data.id });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Pay period locked.' };
}

export async function approveEntries(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = approveTimesheetSchema.safeParse({ ids: json(fd, 'ids') });
  if (!parsed.success) return { ok: false, message: 'Select at least one entry.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approve_timesheet_entries', {
    p_entry_ids: parsed.data.ids,
  });
  if (error) return failed(error);
  refresh();
  const skipped = parsed.data.ids.length - data;
  return {
    ok: true,
    message:
      `Approved ${data} ${data === 1 ? 'entry' : 'entries'}.` +
      (skipped > 0
        ? ` ${skipped} skipped (already approved, your own, or missing a clock-out).`
        : ''),
  };
}

export async function correctEntry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = timesheetCorrectionFormSchema.safeParse({
    entry_id: text(fd, 'entry_id'),
    in_date: text(fd, 'in_date'),
    in_time: text(fd, 'in_time'),
    out_date: text(fd, 'out_date'),
    out_time: text(fd, 'out_time'),
    reason: text(fd, 'reason') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const times = correctionInstants(parsed.data, await getTimeZone(supabase));
  if (!times.ok) {
    return { ok: false, message: times.message, fieldErrors: { [times.field]: times.message } };
  }

  // As the signed-in supervisor: the function audits who, when and why.
  const { error } = await supabase.rpc('correct_timesheet_entry', {
    p_entry_id: parsed.data.entry_id,
    p_clock_in_at: times.clockIn.toISOString(),
    p_clock_out_at: times.clockOut.toISOString(),
    p_reason: parsed.data.reason,
  });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Correction saved. The entry needs approving again.' };
}
