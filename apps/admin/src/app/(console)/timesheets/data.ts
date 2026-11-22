import 'server-only';

import { attendanceFlagLabel, todayInZone, toZoned } from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function loadPeriods(supabase: Supabase) {
  const { data, error } = await supabase
    .from('pay_periods')
    .select('id, starts_on, ends_on, status, locked_at')
    .order('starts_on', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export type Period = Awaited<ReturnType<typeof loadPeriods>>[number];

/** ?period=…, else the open period containing today, else the latest one. */
export function pickPeriod(periods: Period[], requested: string | undefined, timeZone: string) {
  const today = todayInZone(timeZone);
  return (
    periods.find((p) => p.id === requested) ??
    periods.find((p) => p.starts_on <= today && today <= p.ends_on) ??
    periods[0] ??
    null
  );
}

/** Every entry whose work date (company time zone) falls in the period. RLS applies. */
export async function loadEntries(supabase: Supabase, period: Period) {
  const { data, error } = await supabase
    .from('timesheet_entries')
    .select(
      `id, work_date, officer_id, site_id, status, approved_at, flags, worked_minutes,
       original_clock_in_at, original_clock_out_at, corrected_clock_in_at, corrected_clock_out_at,
       clock_in_at, clock_out_at,
       shifts(starts_at, ends_at),
       sites(name, clients(name)),
       officer:profiles!timesheet_entries_officer_id_fkey(full_name, officer_details(employee_number)),
       approver:profiles!timesheet_entries_approved_by_fkey(full_name),
       timesheet_corrections(id, previous_clock_in_at, previous_clock_out_at, new_clock_in_at,
         new_clock_out_at, reason, corrected_at, profiles(full_name))`,
    )
    .gte('work_date', period.starts_on)
    .lte('work_date', period.ends_on)
    .order('work_date')
    .order('corrected_at', { referencedTable: 'timesheet_corrections' })
    .limit(5000);
  if (error) throw new Error(error.message);
  return data;
}

export type Entry = Awaited<ReturnType<typeof loadEntries>>[number];

/** Why an entry needs a second look (empty: nothing unusual). */
export function attention(e: Entry): string[] {
  const out = e.flags.map(attendanceFlagLabel);
  if (!e.clock_in_at && !e.clock_out_at) out.push('Missed');
  else if (!e.clock_out_at) out.push('No clock-out');
  if (e.corrected_clock_in_at || e.corrected_clock_out_at) out.push('Corrected');
  return out;
}

/** Date and time in the company zone, e.g. { date: '2026-01-06', time: '06:02' }. */
export function zoned(iso: string | null, timeZone: string) {
  return iso ? toZoned(iso, timeZone) : null;
}
