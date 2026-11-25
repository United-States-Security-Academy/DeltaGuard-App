import 'server-only';

import { addDaysIso, fromZoned, type ShiftStatus, todayInZone } from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

import { expiredOn, licenceExpiries } from '../data';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Where a shift stands right now. */
export type Stage = 'not_in' | 'missed' | 'on_shift' | 'upcoming' | 'finished';

export type BoardRow = {
  id: string;
  officerId: string;
  officerName: string;
  phone: string | null;
  siteName: string;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  stage: Stage;
  clockIn: string | null;
  clockOut: string | null;
  /** Minutes after the start: late clock-in, or how long they've been absent. */
  minutesLate: number | null;
  late: boolean;
  /** Exception flags other than "late", plus refused attempts. */
  flags: string[];
  expiredLicences: string[];
};

/** Needs attention first, then on shift, upcoming, finished. */
export const STAGE_ORDER: Record<Stage, number> = {
  not_in: 0,
  missed: 1,
  on_shift: 2,
  upcoming: 3,
  finished: 4,
};

export function compareBoardRows(a: BoardRow, b: BoardRow): number {
  return (
    STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
    Number(b.flags.length > 0) - Number(a.flags.length > 0) ||
    a.startsAt.localeCompare(b.startsAt)
  );
}

/**
 * Every shift that touches today (in the company zone), including overnight ones from
 * yesterday, with where each stands right now. RLS applies.
 */
export async function loadTodayBoard(
  supabase: Supabase,
  timeZone: string,
  now: Date,
): Promise<{ ok: true; today: string; rows: BoardRow[] } | { ok: false; error: string }> {
  const today = todayInZone(timeZone, now);
  const dayStart = fromZoned(today, '00:00', timeZone).toISOString();
  const dayEnd = fromZoned(addDaysIso(today, 1), '00:00', timeZone).toISOString();

  const shifts = await supabase
    .from('shifts')
    .select(
      'id, officer_id, starts_at, ends_at, status, sites(name), officer:profiles!shifts_officer_id_fkey(full_name, phone)',
    )
    .neq('status', 'cancelled')
    .lt('starts_at', dayEnd)
    .gt('ends_at', dayStart)
    .order('starts_at');
  if (shifts.error)
    return { ok: false, error: `Could not load today’s shifts: ${shifts.error.message}` };

  const shiftIds = shifts.data.map((s) => s.id);
  const [events, expiries] = await Promise.all([
    shiftIds.length
      ? supabase
          .from('attendance_events')
          .select('shift_id, type, recorded_at, flags, accepted')
          .in('shift_id', shiftIds)
          .order('recorded_at')
      : Promise.resolve({ data: [], error: null }),
    licenceExpiries(supabase, [...new Set(shifts.data.map((s) => s.officer_id))]),
  ]);
  if (events.error)
    return { ok: false, error: `Could not load attendance: ${events.error.message}` };

  const rows: BoardRow[] = shifts.data.map((s) => {
    const mine = events.data.filter((e) => e.shift_id === s.id);
    const clockIn = mine.find((e) => e.accepted && e.type === 'clock_in') ?? null;
    const clockOut = mine.find((e) => e.accepted && e.type === 'clock_out') ?? null;
    const started = Date.parse(s.starts_at) <= now.getTime();

    const stage: Stage =
      s.status === 'missed'
        ? 'missed'
        : s.status === 'completed'
          ? 'finished'
          : s.status === 'in_progress'
            ? 'on_shift'
            : started
              ? 'not_in'
              : 'upcoming';

    const minutesAfterStart = (t: number) =>
      Math.max(0, Math.round((t - Date.parse(s.starts_at)) / 60_000));
    const lateArrival = clockIn !== null && clockIn.flags.includes('late');
    const minutesLate = lateArrival
      ? minutesAfterStart(Date.parse(clockIn.recorded_at))
      : stage === 'not_in'
        ? minutesAfterStart(now.getTime())
        : null;

    const flags = new Set<string>();
    for (const e of mine) {
      if (!e.accepted) flags.add('refused');
      else for (const f of e.flags) if (f !== 'late') flags.add(f);
    }

    return {
      id: s.id,
      officerId: s.officer_id,
      officerName: s.officer?.full_name ?? 'Unnamed officer',
      phone: s.officer?.phone ?? null,
      siteName: s.sites?.name ?? 'Unknown site',
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      status: s.status,
      stage,
      clockIn: clockIn?.recorded_at ?? null,
      clockOut: clockOut?.recorded_at ?? null,
      minutesLate,
      late: lateArrival || stage === 'not_in',
      flags: [...flags],
      expiredLicences: expiredOn(expiries.get(s.officer_id), today),
    };
  });

  return { ok: true, today, rows };
}
