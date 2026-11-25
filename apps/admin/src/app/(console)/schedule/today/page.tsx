import {
  attendanceFlagLabel,
  firstParam,
  formatDate,
  formatTimeRange,
  toZoned,
} from '@deltaguard/shared';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { z } from 'zod';

import { Badge, type BadgeTone, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../data';
import { LiveRefresh } from '../live-refresh';
import { ScheduleTabs } from '../tabs';
import { type BoardRow, compareBoardRows, loadTodayBoard } from './board';
import { StageBadge } from './stage-badge';

const FILTERS = [
  'all',
  'covered',
  'on_shift',
  'late',
  'missed',
  'flagged',
  'upcoming',
  'finished',
] as const;
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
  const board = await loadTodayBoard(supabase, timeZone, now);
  if (!board.ok) return <ErrorText>{board.error}</ErrorText>;
  const { today, rows } = board;

  const matches: Record<Filter, (r: BoardRow) => boolean> = {
    all: () => true,
    // Clocked in: on shift now or finished (the dashboard's "covered").
    covered: (r) => r.stage === 'on_shift' || r.stage === 'finished',
    on_shift: (r) => r.stage === 'on_shift',
    late: (r) => r.late,
    missed: (r) => r.stage === 'missed',
    flagged: (r) => r.flags.length > 0,
    upcoming: (r) => r.stage === 'upcoming',
    finished: (r) => r.stage === 'finished',
  };
  const visible = rows.filter(matches[filter]).sort(compareBoardRows);

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
              className={`panel p-4 transition-shadow ${
                active
                  ? 'ring-2 ring-gold'
                  : 'hover:ring-1 hover:ring-slate-300 dark:hover:ring-slate-600'
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
          Showing {(tiles.find((t) => t.key === filter)?.label ?? 'covered').toLowerCase()} only.{' '}
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
