import { formatTimeRange, toZoned } from '@deltaguard/shared';
import Link from 'next/link';
import { Suspense } from 'react';

import { Avatar, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import {
  AttendanceCard,
  IncidentsBySiteCard,
  LicencesCard,
  NeedsActionCard,
} from './_dashboard/cards';
import {
  type DashboardSummary,
  loadAttendance,
  loadExpiringLicences,
  loadIncidentsBySite,
  loadIncidentsToReview,
  loadSummary,
} from './_dashboard/data';
import { IncidentsCard } from './_dashboard/incidents-card';
import { getTimeZone } from './schedule/data';
import { type BoardRow, compareBoardRows, loadTodayBoard } from './schedule/today/board';
import { StageBadge } from './schedule/today/stage-badge';
import { WelfareDashboardCard } from './welfare/dashboard-card';
import { loadWelfareBoard } from './welfare/data';
import { caughtMessage } from '@/lib/server-errors';

/** Rows shown on the dashboard; the live board has the rest. */
const TODAY_ROWS = 6;

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  await requireStaff(); // also makes this render per request (current time)
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);

  const board = await loadTodayBoard(supabase, timeZone, new Date());
  if (!board.ok) return <ErrorText>{board.error}</ErrorText>;

  let data;
  try {
    const [summary, attendance, bySite, toReview, licences, welfare] = await Promise.all([
      loadSummary(supabase),
      loadAttendance(supabase),
      loadIncidentsBySite(supabase),
      loadIncidentsToReview(supabase),
      loadExpiringLicences(supabase, board.today),
      loadWelfareBoard(supabase),
    ]);
    data = { summary, attendance, bySite, toReview, licences, welfare };
  } catch (e) {
    return <ErrorText>{caughtMessage(e)}</ErrorText>;
  }
  const { summary } = data;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-3">
        <TodayCard summary={summary} rows={board.rows} timeZone={timeZone} />
      </div>
      <div className="lg:col-span-3">
        <WelfareDashboardCard rows={data.welfare} timeZone={timeZone} now={new Date().getTime()} />
      </div>
      <NeedsActionCard summary={summary} />
      <LicencesCard summary={summary} upcoming={data.licences} today={board.today} />
      <IncidentsCard
        incidents={data.toReview}
        total={summary.incidents_awaiting_review}
        timeZone={timeZone}
      />
      <div className="lg:col-span-2">
        <AttendanceCard days={data.attendance} />
      </div>
      <IncidentsBySiteCard sites={data.bySite} today={board.today} />
    </div>
  );
}

function TodayCard({
  summary,
  rows,
  timeZone,
}: {
  summary: DashboardSummary;
  rows: BoardRow[];
  timeZone: string;
}) {
  const shown = [...rows].sort(compareBoardRows).slice(0, TODAY_ROWS);
  const needAttention = summary.not_clocked_in + summary.missed;
  // Each number opens the live board filtered to the shifts behind it.
  const stats = [
    { label: 'Scheduled', value: summary.shifts_scheduled, href: '/schedule/today' },
    { label: 'Covered', value: summary.shifts_covered, href: '/schedule/today?show=covered' },
    { label: 'On duty now', value: summary.on_duty, href: '/schedule/today?show=on_shift' },
    { label: 'Late', value: summary.late, href: '/schedule/today?show=late', tone: 'warn' },
    { label: 'Missed', value: summary.missed, href: '/schedule/today?show=missed', tone: 'bad' },
  ] as const;
  const time = (iso: string | null) => (iso ? toZoned(iso, timeZone).time : '—');

  return (
    <section className="panel p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Today’s shifts</h1>
          <p className="mt-2 text-sm text-muted">
            <span className="font-semibold text-fg">
              {summary.shifts_covered} of {summary.shifts_scheduled} covered
            </span>
            {needAttention > 0 ? (
              <>
                ,{' '}
                <span className="font-semibold text-red-700 dark:text-red-400">
                  {needAttention} need{needAttention === 1 ? 's' : ''} attention
                </span>
              </>
            ) : null}
            {summary.late_arrivals > 0 ? `, ${summary.late_arrivals} arrived late` : null}
          </p>
        </div>
        <dl className="flex flex-wrap divide-x divide-line">
          {stats.map((s) => (
            <div key={s.label} className="px-4 first:pl-0 last:pr-0 sm:px-6">
              <Link href={s.href} className="group flex flex-col-reverse text-center">
                <dt className="mt-1 text-sm text-muted group-hover:text-fg">{s.label}</dt>
                <dd
                  className={`text-4xl font-semibold tabular-nums group-hover:underline sm:text-5xl ${
                    'tone' in s && s.value > 0
                      ? s.tone === 'bad'
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-amber-700 dark:text-amber-400'
                      : ''
                  }`}
                >
                  {s.value}
                </dd>
              </Link>
            </div>
          ))}
        </dl>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-surface-2 p-6 text-center text-sm text-muted">
          No shifts today.{' '}
          <Link href="/schedule/new" className="font-medium text-accent-ink hover:underline">
            Schedule one
          </Link>
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-y border-line">
                <th className="py-3 pr-3 font-medium">Officer</th>
                <th className="px-3 py-3 font-medium">Site</th>
                <th className="px-3 py-3 font-medium">Shift</th>
                <th className="px-3 py-3 font-medium">Clock-in</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="py-3 pl-3 text-right font-medium">Ends</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 pr-3">
                    <Link
                      href={`/officers/${r.officerId}`}
                      className="flex items-center gap-3 font-medium hover:underline"
                    >
                      <Avatar name={r.officerName} size="sm" />
                      {r.officerName}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted">{r.siteName}</td>
                  <td className="px-3 py-3 tabular-nums">
                    <Link href={`/schedule/${r.id}`} className="hover:underline">
                      {formatTimeRange(r.startsAt, r.endsAt, timeZone)}
                    </Link>
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {time(r.clockIn)}
                    {r.clockIn && r.minutesLate ? (
                      <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-400">
                        +{r.minutesLate} min
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <StageBadge row={r} />
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium tabular-nums">
                      {time(r.endsAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 ? (
        <Link
          href="/schedule/today"
          className="mt-4 inline-block text-sm font-medium text-accent-ink hover:underline"
        >
          {rows.length > TODAY_ROWS
            ? `Open the live board (${rows.length - TODAY_ROWS} more) →`
            : 'Open the live board →'}
        </Link>
      ) : null}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-3" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-96 animate-pulse panel lg:col-span-3" />
      <div className="h-64 animate-pulse panel lg:col-span-3" />
      <div className="h-72 animate-pulse panel" />
      <div className="h-72 animate-pulse panel" />
      <div className="h-72 animate-pulse rounded-3xl bg-ink/80 dark:bg-navy" />
      <div className="h-96 animate-pulse panel lg:col-span-2" />
      <div className="h-96 animate-pulse panel" />
    </div>
  );
}
