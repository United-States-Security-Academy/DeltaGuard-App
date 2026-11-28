import { toZoned } from '@deltaguard/shared';
import Link from 'next/link';
import { Suspense } from 'react';

import { EmptyState, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../schedule/data';
import { LiveRefresh, type LiveTable } from '../schedule/live-refresh';
import { WelfareBoardTable } from './board';
import { boardCounts, boardUrgency, loadWelfareBoard } from './data';
import { WelfareTabs } from './tabs';
import { caughtMessage } from '@/lib/server-errors';

const LIVE_TABLES: LiveTable[] = [
  { table: 'welfare_checks' },
  { table: 'device_heartbeats' },
  { table: 'welfare_pauses' },
  { table: 'shifts' },
];

export default function WelfareBoardPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-muted">Loading the welfare board…</p>}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  const now = new Date().getTime();

  let rows;
  try {
    rows = await loadWelfareBoard(supabase);
  } catch (e) {
    return <ErrorText>{caughtMessage(e)}</ErrorText>;
  }
  const sorted = [...rows].sort(
    (a, b) =>
      boardUrgency(a, now) - boardUrgency(b, now) || a.officerName.localeCompare(b.officerName),
  );
  const c = boardCounts(rows, now);
  const stats = [
    { label: 'On duty', value: c.onDuty },
    { label: 'Checks running', value: c.monitored },
    { label: 'Escalated', value: c.escalated, bad: true },
    { label: 'Alarm / calling', value: c.alarm, bad: true },
    { label: 'Waiting for answer', value: c.waiting, warn: true },
    { label: 'Phone issues', value: c.phoneIssues, warn: true },
    { label: 'Paused', value: c.paused },
  ];

  return (
    <>
      <WelfareTabs current="board" isAdmin={staff.role === 'admin'} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LiveRefresh
          renderedAt={toZoned(new Date(now), timeZone).time}
          channel="welfare-board"
          tables={LIVE_TABLES}
        />
        {staff.role === 'supervisor' ? (
          <p className="text-sm text-muted">Showing the sites you are assigned to.</p>
        ) : null}
      </div>

      <dl className="flex flex-wrap gap-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-32 flex-1 panel px-4 py-3">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd
              className={`text-3xl font-semibold tabular-nums ${
                s.value > 0 && s.bad
                  ? 'text-red-700 dark:text-red-400'
                  : s.value > 0 && s.warn
                    ? 'text-amber-700 dark:text-amber-400'
                    : ''
              }`}
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      {rows.length === 0 ? (
        <EmptyState>
          Nobody is on duty right now.{' '}
          <Link href="/schedule/today" className="font-medium text-accent-ink hover:underline">
            Today’s shifts
          </Link>
        </EmptyState>
      ) : (
        <section className="panel p-4 sm:p-5">
          <WelfareBoardTable rows={sorted} timeZone={timeZone} isAdmin={staff.role === 'admin'} />
        </section>
      )}
      <p className="text-xs text-muted">
        Phones send a heartbeat every few minutes while on duty; one older than 10 minutes is shown
        in red. Location is never collected for welfare checks.
      </p>
    </>
  );
}
