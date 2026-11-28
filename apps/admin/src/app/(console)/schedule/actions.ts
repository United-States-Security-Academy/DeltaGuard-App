'use server';

import {
  formatDate,
  isEditableShiftStatus,
  recordIdSchema,
  type ScheduleShiftInput,
  scheduleShiftSchema,
  shiftOccurrences,
  shiftSchema,
  type ShiftTimes,
  startOfWeekIso,
} from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { requireStaff } from '@/lib/auth';
import { checked, num, text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

import {
  findLicenceWarnings,
  findOverlaps,
  getTimeZone,
  type LicenceWarning,
  type OverlapWarning,
} from './data';

// Admins and supervisors schedule shifts (RLS allows both). Every action
// re-checks the caller, because server actions are public HTTP endpoints.
// Shifts are cancelled, never deleted: they are the attendance history.

/** Postgres exclusion violation: shifts_no_overlap. */
const EXCLUSION_VIOLATION = '23P01';

type Supabase = Awaited<ReturnType<typeof createClient>>;

function formFields(fd: FormData) {
  return {
    site_id: text(fd, 'site_id'),
    officer_id: text(fd, 'officer_id'),
    date: text(fd, 'date'),
    start_time: text(fd, 'start_time'),
    end_time: text(fd, 'end_time'),
    repeat_weeks: num(fd, 'repeat_weeks') ?? 1,
    notes: text(fd, 'notes'),
  };
}

/** Each occurrence must also pass the row schema (ends after start, ≤ 24 h). */
function validOccurrences(
  input: ScheduleShiftInput,
  timeZone: string,
): { ok: true; occurrences: ShiftTimes[] } | { ok: false; error: ActionState } {
  const occurrences = shiftOccurrences(input, timeZone);
  for (const o of occurrences) {
    const row = shiftSchema.safeParse({ ...input, starts_at: o.starts_at, ends_at: o.ends_at });
    if (!row.success) return { ok: false, error: invalid(row.error) };
  }
  return { ok: true, occurrences };
}

/** Only active officers who are assigned to the site can be scheduled there. */
async function officerProblem(
  supabase: Supabase,
  input: ScheduleShiftInput,
): Promise<string | null> {
  const [officer, assignment] = await Promise.all([
    supabase
      .from('profiles')
      .select('role, employment_status')
      .eq('id', input.officer_id)
      .maybeSingle(),
    supabase
      .from('site_assignments')
      .select('id')
      .eq('site_id', input.site_id)
      .eq('officer_id', input.officer_id)
      .maybeSingle(),
  ]);
  if (officer.data?.role !== 'officer' || officer.data.employment_status !== 'active') {
    return 'Only active officers can be scheduled.';
  }
  if (!assignment.data) {
    return 'This officer isn’t assigned to this site. Assign them on the site page first.';
  }
  return null;
}

function writeError(error: { code?: string; message: string }): ActionState {
  if (error.code === EXCLUSION_VIOLATION) {
    return {
      ok: false,
      message:
        'This officer already has a shift at that time (it was probably just added). Reload and try again.',
    };
  }
  // Includes shifts_before_write's "must be assigned" check (23514), which is already readable.
  return failed(error);
}

function overlapMessage(overlaps: OverlapWarning[]): string {
  const list = overlaps.map((o) => `${formatDate(o.date)} clashes with ${o.siteName} (${o.when})`);
  return `Overlapping shifts: ${list.join('; ')}.`;
}

function licenceMessage(licences: LicenceWarning[]): string {
  return `${licences.map((l) => l.message).join(' ')} Tick “Schedule anyway” to confirm.`;
}

// ---------------------------------------------------------------------------
// Live check while the form is filled in
// ---------------------------------------------------------------------------

export type ShiftCheck = {
  overlaps: OverlapWarning[];
  licences: LicenceWarning[];
  /** Officer isn't assigned to the site or isn't active. */
  officerProblem: string | null;
  /** Invalid times etc. */
  inputError: string | null;
};

/**
 * Read-only: what would go wrong if this shift were saved. Called by the form
 * as the user types, so the warnings show before they press Save.
 */
export async function checkShift(raw: {
  site_id: string;
  officer_id: string;
  date: string;
  start_time: string;
  end_time: string;
  repeat_weeks: number;
  exclude_shift_id?: string;
}): Promise<ShiftCheck | null> {
  await requireStaff();
  const parsed = scheduleShiftSchema.safeParse({ ...raw, notes: null });
  const exclude = raw.exclude_shift_id
    ? recordIdSchema.safeParse({ id: raw.exclude_shift_id })
    : null;
  if (!parsed.success || (exclude && !exclude.success)) return null;

  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  const result = validOccurrences(parsed.data, timeZone);
  if (!result.ok) {
    return {
      overlaps: [],
      licences: [],
      officerProblem: null,
      inputError: result.error?.message ?? 'Invalid times',
    };
  }
  const [overlaps, licences, problem] = await Promise.all([
    findOverlaps(supabase, parsed.data.officer_id, result.occurrences, timeZone, exclude?.data?.id),
    findLicenceWarnings(
      supabase,
      parsed.data.officer_id,
      result.occurrences.map((o) => o.date),
    ),
    officerProblem(supabase, parsed.data),
  ]);
  return { overlaps, licences, officerProblem: problem, inputError: null };
}

// ---------------------------------------------------------------------------
// Create (with weekly repeats)
// ---------------------------------------------------------------------------

export async function createShift(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = scheduleShiftSchema.safeParse(formFields(fd));
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  const result = validOccurrences(input, timeZone);
  if (!result.ok) return result.error;

  const problem = await officerProblem(supabase, input);
  if (problem) return { ok: false, message: problem, fieldErrors: { officer_id: problem } };

  let occurrences: ShiftTimes[] = result.occurrences;
  const [overlaps, licences] = await Promise.all([
    findOverlaps(supabase, input.officer_id, occurrences, timeZone),
    findLicenceWarnings(
      supabase,
      input.officer_id,
      occurrences.map((o) => o.date),
    ),
  ]);

  if (overlaps.length > 0) {
    if (!checked(fd, 'skip_conflicts')) return { ok: false, message: overlapMessage(overlaps) };
    const clashing = new Set(overlaps.map((o) => o.date));
    occurrences = occurrences.filter((o) => !clashing.has(o.date));
    if (occurrences.length === 0) {
      return { ok: false, message: 'Every one of these shifts clashes with an existing shift.' };
    }
  }
  if (licences.length > 0 && !checked(fd, 'confirm_licence')) {
    return { ok: false, message: licenceMessage(licences) };
  }

  // One insert: all occurrences are saved, or none are.
  const { error } = await supabase.from('shifts').insert(
    occurrences.map((o) => ({
      site_id: input.site_id,
      officer_id: input.officer_id,
      starts_at: o.starts_at,
      ends_at: o.ends_at,
      notes: input.notes,
    })),
  );
  if (error) return writeError(error);

  redirect(scheduleHref(fd, input.date));
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function updateShift(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const parsed = scheduleShiftSchema.safeParse({ ...formFields(fd), repeat_weeks: 1 });
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('shifts')
    .select('site_id, officer_id, starts_at, ends_at, status')
    .eq('id', id.data.id)
    .maybeSingle();
  if (!existing) return { ok: false, message: 'Shift not found.' };
  if (!isEditableShiftStatus(existing.status)) {
    return {
      ok: false,
      message: `This shift is ${existing.status.replace('_', ' ')} and can’t be edited.`,
    };
  }

  const timeZone = await getTimeZone(supabase);
  const result = validOccurrences(input, timeZone);
  if (!result.ok) return result.error;
  const [occurrence] = result.occurrences;
  if (!occurrence) return { ok: false, message: 'Invalid shift times.' };

  const problem = await officerProblem(supabase, input);
  if (problem) return { ok: false, message: problem, fieldErrors: { officer_id: problem } };

  const [overlaps, licences] = await Promise.all([
    findOverlaps(supabase, input.officer_id, [occurrence], timeZone, id.data.id),
    findLicenceWarnings(supabase, input.officer_id, [occurrence.date]),
  ]);
  if (overlaps.length > 0) return { ok: false, message: overlapMessage(overlaps) };
  if (licences.length > 0 && !checked(fd, 'confirm_licence')) {
    return { ok: false, message: licenceMessage(licences) };
  }

  // A change to who, where or when needs the officer to acknowledge again.
  const changed =
    existing.site_id !== input.site_id ||
    existing.officer_id !== input.officer_id ||
    Date.parse(existing.starts_at) !== Date.parse(occurrence.starts_at) ||
    Date.parse(existing.ends_at) !== Date.parse(occurrence.ends_at);

  const { data, error } = await supabase
    .from('shifts')
    .update({
      site_id: input.site_id,
      officer_id: input.officer_id,
      starts_at: occurrence.starts_at,
      ends_at: occurrence.ends_at,
      notes: input.notes,
      ...(changed ? { status: 'scheduled' as const } : {}),
    })
    .eq('id', id.data.id)
    // Not if someone clocked in meanwhile.
    .in('status', ['scheduled', 'acknowledged'])
    .select('id');
  if (error) return writeError(error);
  if (!data.length)
    return { ok: false, message: 'This shift has started or changed. Reload and try again.' };

  refresh();
  return {
    ok: true,
    message:
      changed && existing.status === 'acknowledged'
        ? 'Shift saved. The officer will need to acknowledge it again.'
        : 'Shift saved.',
  };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelShift(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('shifts')
    .update({ status: 'cancelled' })
    .eq('id', id.data.id)
    .in('status', ['scheduled', 'acknowledged'])
    .select('id');
  if (error) return failed(error);
  if (!data.length) {
    return { ok: false, message: 'Only shifts that haven’t started can be cancelled.' };
  }

  refresh();
  return { ok: true, message: 'Shift cancelled.' };
}

/** Back to the week containing `date`, in the view the form came from. */
function scheduleHref(fd: FormData, date: string): string {
  const view = text(fd, 'view') === 'officer' ? 'officer' : 'site';
  return `/schedule?view=${view}&week=${startOfWeekIso(date)}`;
}
