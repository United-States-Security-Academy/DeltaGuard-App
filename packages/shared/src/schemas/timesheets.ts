import { z } from 'zod';

import { daysBetween } from '../dates';
import { fromZoned } from '../time-zone';
import { isoDateSchema } from './common';

// Mirrors public.pay_periods and the correct_timesheet_entry() /
// approve_timesheet_entries() arguments. The database re-checks everything.

export const PAY_PERIOD_MAX_DAYS = 63;

/** Admin: a new pay period (dates in the company time zone, inclusive). */
export const payPeriodSchema = z
  .object({ starts_on: isoDateSchema, ends_on: isoDateSchema })
  .refine((p) => p.ends_on >= p.starts_on, {
    message: 'The end must be on or after the start',
    path: ['ends_on'],
  })
  .refine((p) => daysBetween(p.starts_on, p.ends_on) < PAY_PERIOD_MAX_DAYS, {
    message: `A pay period can be at most ${PAY_PERIOD_MAX_DAYS} days`,
    path: ['ends_on'],
  });
export type PayPeriodInput = z.infer<typeof payPeriodSchema>;

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/**
 * A correction as typed: dates and times in the company time zone. The
 * clock-out date is separate so a night shift can end the next day.
 */
export const timesheetCorrectionFormSchema = z.object({
  entry_id: z.uuid(),
  in_date: isoDateSchema,
  in_time: clockTime,
  out_date: isoDateSchema,
  out_time: clockTime,
  reason: z.string().trim().min(3, 'Say why the times are being changed').max(1000),
});
export type TimesheetCorrectionForm = z.infer<typeof timesheetCorrectionFormSchema>;

/** The form converted to instants, checked like the database does. */
export function correctionInstants(
  form: TimesheetCorrectionForm,
  timeZone: string,
): { ok: true; clockIn: Date; clockOut: Date } | { ok: false; field: string; message: string } {
  const clockIn = fromZoned(form.in_date, form.in_time, timeZone);
  const clockOut = fromZoned(form.out_date, form.out_time, timeZone);
  if (clockOut <= clockIn) {
    return {
      ok: false,
      field: 'out_time',
      message: 'The clock-out must be after the clock-in (for a night shift, set the next day)',
    };
  }
  if (clockOut.getTime() - clockIn.getTime() > 24 * 60 * 60_000) {
    return { ok: false, field: 'out_time', message: 'A shift can be at most 24 hours long' };
  }
  return { ok: true, clockIn, clockOut };
}

export const approveTimesheetSchema = z.object({
  ids: z.array(z.uuid()).min(1, 'Select at least one entry').max(1000),
});

/** 477 -> "7:57". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const sign = minutes < 0 ? '-' : '';
  const m = Math.abs(minutes);
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** 477 -> 7.95 (decimal hours, 2 places, for payroll). */
export function decimalHours(minutes: number | null | undefined): number {
  return Math.round(((minutes ?? 0) / 60) * 100) / 100;
}
