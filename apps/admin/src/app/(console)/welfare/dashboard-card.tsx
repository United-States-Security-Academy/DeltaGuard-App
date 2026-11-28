import { toZoned } from '@deltaguard/shared';
import Link from 'next/link';

import { LiveRefresh, type LiveTable } from '../schedule/live-refresh';

import { type BoardRow, boardCounts, boardUrgency } from './data';
import { WelfareBoardTable } from './board';

const ROWS = 6;

// Heartbeats are left out on purpose: they would re-render the whole dashboard
// every few seconds. Their ages tick in the browser and the page refreshes each minute.
const LIVE_TABLES: LiveTable[] = [{ table: 'welfare_checks' }, { table: 'welfare_pauses' }];

/** Dashboard panel: the welfare board's most urgent rows and counts. */
export function WelfareDashboardCard({
  rows,
  timeZone,
  now,
}: {
  rows: BoardRow[];
  timeZone: string;
  now: number;
}) {
  const c = boardCounts(rows, now);
  const shown = [...rows]
    .sort(
      (a, b) =>
        boardUrgency(a, now) - boardUrgency(b, now) || a.officerName.localeCompare(b.officerName),
    )
    .slice(0, ROWS);
  const alerts = c.escalated + c.alarm;

  return (
    <section className="panel p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Welfare checks</h2>
          <p className="mt-1 text-sm text-muted">
            {c.monitored} of {c.onDuty} on duty monitored
            {alerts > 0 ? (
              <>
                ,{' '}
                <span className="font-semibold text-red-700 dark:text-red-400">
                  {alerts} not answering
                </span>
              </>
            ) : null}
            {c.phoneIssues > 0
              ? `, ${c.phoneIssues} phone issue${c.phoneIssues === 1 ? '' : 's'}`
              : ''}
            {c.paused > 0 ? `, ${c.paused} paused` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <LiveRefresh
            renderedAt={toZoned(new Date(now), timeZone).time}
            channel="dashboard-welfare"
            tables={LIVE_TABLES}
          />
          <Link href="/welfare" className="text-sm font-medium text-accent-ink hover:underline">
            Open the welfare board →
          </Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-surface-2 p-6 text-center text-sm text-muted">
          Nobody is on duty right now.
        </p>
      ) : (
        <div className="mt-4">
          <WelfareBoardTable rows={shown} timeZone={timeZone} isAdmin={false} compact />
          {rows.length > ROWS ? (
            <p className="mt-3 text-sm text-muted">
              {rows.length - ROWS} more on the welfare board.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
