import 'server-only';

import { decimalHours, formatMinutes, toZoned } from '@deltaguard/shared';

import type { Entry } from './data';

// THE PAYROLL EXPORT LAYOUT. One place to change: the CSV and the XLSX both
// use these columns, in this order.
//
// PLACEHOLDER: these are sensible defaults until Deltacon's payroll columns
// are provided. Replace `header` / `value` (and add or remove entries) to
// match the payroll system's import format exactly.

export type PayrollCell = string | number | null;

export type PayrollColumn = {
  header: string;
  /** Width in the XLSX (characters). */
  width: number;
  value: (row: Entry, ctx: { timeZone: string }) => PayrollCell;
};

const time = (iso: string | null, timeZone: string) => (iso ? toZoned(iso, timeZone) : null);

/** "2026-01-06 06:02" in the company time zone. */
const stamp = (iso: string | null, timeZone: string) => {
  const z = time(iso, timeZone);
  return z ? `${z.date} ${z.time}` : null;
};

export const PAYROLL_COLUMNS: PayrollColumn[] = [
  {
    header: 'Employee number',
    width: 16,
    value: (r) => r.officer?.officer_details?.employee_number ?? null,
  },
  { header: 'Officer', width: 26, value: (r) => r.officer?.full_name ?? null },
  { header: 'Site', width: 24, value: (r) => r.sites?.name ?? null },
  { header: 'Client', width: 24, value: (r) => r.sites?.clients?.name ?? null },
  { header: 'Work date', width: 12, value: (r) => r.work_date },
  {
    header: 'Scheduled start',
    width: 17,
    value: (r, c) => stamp(r.shifts?.starts_at ?? null, c.timeZone),
  },
  {
    header: 'Scheduled end',
    width: 17,
    value: (r, c) => stamp(r.shifts?.ends_at ?? null, c.timeZone),
  },
  { header: 'Clock in', width: 17, value: (r, c) => stamp(r.clock_in_at, c.timeZone) },
  { header: 'Clock out', width: 17, value: (r, c) => stamp(r.clock_out_at, c.timeZone) },
  {
    header: 'Worked minutes',
    width: 10,
    value: (r) => r.worked_minutes ?? 0,
  },
  {
    header: 'Worked hours',
    width: 10,
    value: (r) => decimalHours(r.worked_minutes),
  },
  { header: 'Worked (h:mm)', width: 10, value: (r) => formatMinutes(r.worked_minutes ?? 0) },
  {
    header: 'Corrected',
    width: 10,
    value: (r) => (r.corrected_clock_in_at || r.corrected_clock_out_at ? 'Yes' : 'No'),
  },
  {
    header: 'Correction reason',
    width: 40,
    value: (r) => r.timesheet_corrections.at(-1)?.reason ?? null,
  },
  { header: 'Flags', width: 24, value: (r) => r.flags.join(', ') || null },
  { header: 'Approved by', width: 22, value: (r) => r.approver?.full_name ?? null },
  { header: 'Approved at', width: 17, value: (r, c) => stamp(r.approved_at, c.timeZone) },
];
