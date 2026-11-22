import {
  addDaysIso,
  attendanceFlagLabel,
  firstParam,
  formatDate,
  formatTimeRange,
  fromZoned,
  type ShiftStatus,
  todayInZone,
  toZoned,
} from '@deltaguard/shared';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { z } from 'zod';

import { Badge, type BadgeTone, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { expiredOn, getTimeZone, licenceExpiries } from '../data';
import { LiveRefresh } from '../live-refresh';
import { ScheduleTabs } from '../tabs';

const FILTERS = ['all', 'on_shift', 'late', 'missed', 'flagged', 'upcoming', 'finished'] as const;
type Filter = (typeof FILTERS)[number];
const filterSchema = z.preprocess(firstParam, z.enum(FILTERS)).catch('all');

export default function TodayPage({ searchParams }: PageProps<'/schedule/today'>) {
  return (
    <div className="flex flex-col gap-6">
      <ScheduleTabs current="today" />
      <Suspense fallback={<p className="text-slate-500">Loading today’s board…</p>}>
        <TodayBoard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Where a shift stands right now. */
type Stage = 'not_in' | 'missed' | 'on_shift' | 'upcoming' | 'finished';

type BoardRow = {
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

const STAGE_ORDER: Record<Stage, number> = {
  not_in: 0,
  missed: 1,
  on_shift: 2,
  upcoming: 3,
  finished: 4,
};

async function TodayBoard({
  searchParams,
}: {
  searchParams: PageProps<'/schedule/today'>['searchParams'];
}) {
  await requireStaff();
  await connection(); // the board depends on the current time
  const filter = filterSchema.parse((await searchParams).show);
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  const now = new Date();
  const today = todayInZone(timeZone, now);
  const dayStart = fromZoned(today, '00:00', timeZone).toISOString();
  const dayEnd = fromZoned(addDaysIso(today, 1), '00:00', timeZone).toISOString();

  // Every shift that touches today, including overnight ones from yesterday.
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
    return <ErrorText>Could not load today’s shifts: {shifts.error.message}</ErrorText>;

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
  if (events.error) return <ErrorText>Could not load attendance: {events.error.message}</ErrorText>;

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

  const matches: Record<Filter, (r: BoardRow) => boolean> = {
    all: () => true,
    on_shift: (r) => r.stage === 'on_shift',
    late: (r) => r.late,
    missed: (r) => r.stage === 'missed',
    flagged: (r) => r.flags.length > 0,
    upcoming: (r) => r.stage === 'upcoming',
    finished: (r) => r.stage === 'finished',
  };
  const visible = rows
    .filter(matches[filter])
    .sort(
      (a, b) =>
        STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
        Number(b.flags.length > 0) - Number(a.flags.length > 0) ||
        a.startsAt.localeCompare(b.startsAt),
    );

  const tiles: { key: Filter; label: string; tone: BadgeTone }[] = [
    { key: 'on_shift', label: 'On shift', tone: 'good' },
    { key: 'late', label: 'Late', tone: 'warn' },
    { key: 'missed', label: 'Missed', tone: 'bad' },
    { key: 'flagged', label: 'Flagged', tone: 'bad' },
    { key: 'upcoming', label: 'Upcoming', tone: 'neutral' },
    { key: 'finished', label: 'Finished', tone: 'neutral' },
  ];
  const time = (iso: string) => toZoned(iso, timeZone).time;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{formatDate(today)}</h2>
        <LiveRefresh renderedAt={toZoned(now, timeZone).time} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const count = rows.filter(matches[t.key]).length;
          const active = filter === t.key;
          return (
            <Link
              key={t.key}
              href={active ? '/schedule/today' : `/schedule/today?show=${t.key}`}
              aria-current={active ? 'true' : undefined}
              className={`rounded-xl border p-3 transition-colors ${
                active
                  ? 'border-slate-900 dark:border-white'
                  : 'border-slate-200 hover:border-slate-400 dark:border-slate-800 dark:hover:border-slate-600'
              }`}
            >
              <div
                className={`text-3xl font-bold tabular-nums ${count > 0 ? TILE_TEXT[t.tone] : 'text-slate-400'}`}
              >
                {count}
              </div>
              <div className="text-sm text-slate-500">{t.label}</div>
            </Link>
          );
        })}
      </div>

      {filter !== 'all' ? (
        <p className="text-sm text-slate-500">
          Showing {tiles.find((t) => t.key === filter)?.label.toLowerCase()} only.{' '}
          <Link href="/schedule/today" className="underline">
            Show all
          </Link>
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState>
          {rows.length === 0 ? 'No shifts today.' : 'Nobody in this group right now.'}
        </EmptyState>
      ) : (
        <Table head={['Officer', 'Site', 'Shift', 'Clock-in', 'Clock-out', 'Status']}>
          {visible.map((r) => (
            <tr
              key={r.id}
              className={
                r.stage === 'not_in' || r.stage === 'missed'
                  ? 'bg-red-50/60 dark:bg-red-950/20'
                  : ''
              }
            >
              <td className="px-3 py-3">
                <Link href={`/officers/${r.officerId}`} className="font-medium hover:underline">
                  {r.officerName}
                </Link>
                {r.phone ? (
                  <div>
                    <a href={`tel:${r.phone}`} className="text-xs text-slate-500 hover:underline">
                      {r.phone}
                    </a>
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-3">{r.siteName}</td>
              <td className="px-3 py-3 tabular-nums">
                <Link href={`/schedule/${r.id}`} className="hover:underline">
                  {formatTimeRange(r.startsAt, r.endsAt, timeZone)}
                </Link>
                {toZoned(r.startsAt, timeZone).date !== today ? (
                  <div className="text-xs text-slate-500">from yesterday</div>
                ) : null}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {r.clockIn ? time(r.clockIn) : '—'}
                {r.clockIn && r.minutesLate ? (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    {r.minutesLate} min late
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {r.clockOut ? time(r.clockOut) : '—'}
                {!r.clockOut && r.stage === 'on_shift' && Date.parse(r.endsAt) < now.getTime() ? (
                  <div className="text-xs text-amber-700 dark:text-amber-400">Not clocked out</div>
                ) : null}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1">
                  <StageBadge row={r} />
                  {r.clockIn && r.late ? <Badge tone="warn">Late</Badge> : null}
                  {r.flags.map((f) => (
                    <Badge key={f} tone={f === 'early_leave' ? 'warn' : 'bad'}>
                      {f === 'refused' ? 'Refused attempt' : attendanceFlagLabel(f)}
                    </Badge>
                  ))}
                  {r.expiredLicences.length > 0 ? (
                    <span title={r.expiredLicences.join(', ')}>
                      <Badge tone="bad">Licence expired</Badge>
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-xs text-slate-500">
        Times are in {timeZone.replace('_', ' ')} time. Shifts with no clock-in are marked missed a
        few minutes after the late grace period ends.
      </p>
    </div>
  );
}

const TILE_TEXT: Record<BadgeTone, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  neutral: 'text-slate-900 dark:text-slate-100',
};

function StageBadge({ row }: { row: BoardRow }) {
  switch (row.stage) {
    case 'not_in':
      return <Badge tone="bad">Not clocked in · {row.minutesLate} min</Badge>;
    case 'missed':
      return <Badge tone="bad">Missed</Badge>;
    case 'on_shift':
      return <Badge tone="good">On shift</Badge>;
    case 'upcoming':
      return (
        <Badge>{row.status === 'acknowledged' ? 'Upcoming · acknowledged' : 'Upcoming'}</Badge>
      );
    case 'finished':
      return <Badge>Finished</Badge>;
  }
}
