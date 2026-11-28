import { z } from 'zod';

import { ATTENDANCE_TYPES, HANDOVER_NOTE_MAX, SHIFT_STATUSES } from '../constants';
import { addDaysIso } from '../dates';
import { fromZoned, isValidTimeZone } from '../time-zone';
import { isoDateSchema, optionalText } from './common';

// Mirrors public.shifts, public.settings and the clock_event() arguments.

export const shiftStatusSchema = z.enum(SHIFT_STATUSES);
export type ShiftStatus = z.infer<typeof shiftStatusSchema>;

export const attendanceTypeSchema = z.enum(ATTENDANCE_TYPES);
export type AttendanceType = z.infer<typeof attendanceTypeSchema>;

const MAX_SHIFT_MS = 24 * 60 * 60 * 1000;

/** Admins and supervisors: create or edit a shift. Times are ISO strings with an offset. */
export const shiftSchema = z
  .object({
    site_id: z.uuid(),
    officer_id: z.uuid(),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    notes: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => (v === '' ? null : v))
      .nullable(),
  })
  .refine((s) => Date.parse(s.ends_at) > Date.parse(s.starts_at), {
    message: 'The shift must end after it starts',
    path: ['ends_at'],
  })
  .refine((s) => Date.parse(s.ends_at) - Date.parse(s.starts_at) <= MAX_SHIFT_MS, {
    message: 'A shift can be at most 24 hours long',
    path: ['ends_at'],
  });
export type ShiftInput = z.infer<typeof shiftSchema>;

// Schedule form (admin console) ------------------------------------------------

/** Shift statuses that can still be edited or cancelled (nobody has clocked in). */
export const EDITABLE_SHIFT_STATUSES = [
  'scheduled',
  'acknowledged',
] as const satisfies readonly ShiftStatus[];

export function isEditableShiftStatus(status: ShiftStatus): boolean {
  return (EDITABLE_SHIFT_STATUSES as readonly ShiftStatus[]).includes(status);
}

export const SHIFT_REPEAT_MAX_WEEKS = 12;

const clockTimeSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use the format HH:MM');

/**
 * What a person types: a day and wall-clock times in the company time zone.
 * An end time at or before the start time means the shift ends the next day
 * (overnight). `repeat_weeks` = how many weekly occurrences to create (1 = no repeat).
 */
export const scheduleShiftSchema = z
  .object({
    site_id: z.uuid('Choose a site'),
    officer_id: z.uuid('Choose an officer'),
    date: isoDateSchema,
    start_time: clockTimeSchema,
    end_time: clockTimeSchema,
    repeat_weeks: z
      .number('Enter a number of weeks')
      .int()
      .min(1, 'At least 1')
      .max(SHIFT_REPEAT_MAX_WEEKS, `At most ${SHIFT_REPEAT_MAX_WEEKS} weeks`),
    notes: optionalText(2000),
  })
  .refine((s) => s.start_time !== s.end_time, {
    message: 'The shift can’t start and end at the same time',
    path: ['end_time'],
  });
export type ScheduleShiftInput = z.infer<typeof scheduleShiftSchema>;

export type ShiftTimes = { date: string; starts_at: string; ends_at: string };

/** The instants of each weekly occurrence of a schedule form entry. */
export function shiftOccurrences(input: ScheduleShiftInput, timeZone: string): ShiftTimes[] {
  const overnight = input.end_time <= input.start_time;
  return Array.from({ length: input.repeat_weeks }, (_, week) => {
    const date = addDaysIso(input.date, week * 7);
    const endDate = overnight ? addDaysIso(date, 1) : date;
    return {
      date,
      starts_at: fromZoned(date, input.start_time, timeZone).toISOString(),
      ends_at: fromZoned(endDate, input.end_time, timeZone).toISOString(),
    };
  });
}

/** Admin-only: company-wide settings. */
export const settingsSchema = z.object({
  late_grace_minutes: z.number().int().min(0).max(240),
  early_clock_in_minutes: z.number().int().min(0).max(720),
  low_accuracy_threshold_m: z.number().int().min(5).max(5000),
  time_zone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
  /** Phones that fail the integrity check: flag their actions, or refuse them (phase 20). */
  integrity_enforcement: z.enum(['monitor', 'block']),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

/**
 * What the phone sends to clock_event(). The database re-checks everything
 * and uses its own clock; device_time is only kept for reference, except for
 * an event queued while offline (`p_queued`): the time rules then use
 * device_time (at most 72 hours old) and the event is flagged `delayed`.
 */
export const clockEventSchema = z.object({
  p_shift_id: z.uuid(),
  p_type: attendanceTypeSchema,
  p_latitude: z.number().min(-90).max(90),
  p_longitude: z.number().min(-180).max(180),
  p_accuracy_m: z.number().min(0).nullable(),
  p_is_mock_location: z.boolean(),
  p_device_id: z.string().min(1).max(200),
  p_device_time: z.iso.datetime({ offset: true }).optional(),
  p_queued: z.boolean().optional(),
  /** Clock-out only: a note for the next officer at the site. */
  p_handover_note: z.string().trim().max(HANDOVER_NOTE_MAX).optional(),
});
export type ClockEventInput = z.infer<typeof clockEventSchema>;
