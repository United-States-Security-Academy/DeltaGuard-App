import { formatTimeRange, toZoned, WELFARE_POLICY_SOURCE_LABELS } from '@deltaguard/shared';
import Link from 'next/link';

import { Avatar, Badge } from '@/components/ui';

import { type BoardRow, isBatteryLow } from './data';
import {
  formatSeconds,
  HEARTBEAT_STALE_MINUTES,
  responseFlagLabel,
  WELFARE_STATUS_TONE,
  welfareStatusLabel,
} from './labels';
import { PauseControl } from './pause-control';
import { Countdown, Since } from './ticking';

/**
 * Officers on duty with their welfare state. `compact` (dashboard) drops the
 * shift and pause columns.
 */
export function WelfareBoardTable({
  rows,
  timeZone,
  isAdmin,
  compact = false,
}: {
  rows: BoardRow[];
  timeZone: string;
  isAdmin: boolean;
  compact?: boolean;
}) {
  const time = (iso: string) => toZoned(iso, timeZone).time;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-y border-line">
            <th className="py-3 pr-3 font-medium">Officer</th>
            {compact ? null : <th className="px-3 py-3 font-medium">Shift</th>}
            <th className="px-3 py-3 font-medium">Last check</th>
            <th className="px-3 py-3 font-medium">Next check</th>
            <th className="px-3 py-3 font-medium">Phone heartbeat</th>
            <th className="px-3 py-3 font-medium">Battery</th>
            <th className="px-3 py-3 font-medium">This shift</th>
            {compact || !isAdmin ? null : <th className="py-3 pl-3 font-medium">Pause</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.shiftId}
              className={`border-b border-line align-top last:border-b-0 ${
                r.open?.status === 'escalated' ? 'bg-red-50/70 dark:bg-red-950/30' : ''
              }`}
            >
              <td className="py-3 pr-3">
                <div className="flex items-center gap-3">
                  <Avatar name={r.officerName} size="sm" />
                  <div className="min-w-0">
                    <Link
                      href={`/officers/${r.officerId}?tab=welfare`}
                      className="font-medium hover:underline"
                    >
                      {r.officerName}
                    </Link>
                    <p className="text-xs text-muted">{r.siteName}</p>
                  </div>
                </div>
              </td>
              {compact ? null : (
                <td className="px-3 py-3 tabular-nums">
                  <Link href={`/schedule/${r.shiftId}`} className="hover:underline">
                    {formatTimeRange(r.startsAt, r.endsAt, timeZone)}
                  </Link>
                  <p className="text-xs text-muted">
                    {r.policyName ?? 'No policy'}
                    {r.policySource === 'officer' ? ' (officer’s own)' : ''}
                  </p>
                </td>
              )}
              <td className="px-3 py-3">
                <LastCheck row={r} time={time} />
              </td>
              <td className="px-3 py-3">
                <NextCheck row={r} time={time} />
              </td>
              <td className="px-3 py-3">
                {r.heartbeat ? (
                  <>
                    <Since
                      at={r.heartbeat.at}
                      fallback={time(r.heartbeat.at)}
                      staleMinutes={HEARTBEAT_STALE_MINUTES}
                    />
                    <p className="text-xs text-muted capitalize">App {r.heartbeat.appState}</p>
                  </>
                ) : (
                  <span className="text-red-700 dark:text-red-400">None yet</span>
                )}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {r.heartbeat?.battery !== null && r.heartbeat?.battery !== undefined ? (
                  <span
                    className={isBatteryLow(r) ? 'font-medium text-red-700 dark:text-red-400' : ''}
                  >
                    {r.heartbeat.battery}%
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {r.answered} answered
                {r.missed ? (
                  <span className="block text-xs font-medium text-red-700 dark:text-red-400">
                    {r.missed} missed
                  </span>
                ) : null}
              </td>
              {compact || !isAdmin ? null : (
                <td className="py-3 pl-3">
                  {r.checksEnabled || r.pause ? (
                    <PauseControl shiftId={r.shiftId} paused={r.pause !== null} compact />
                  ) : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LastCheck({ row, time }: { row: BoardRow; time: (iso: string) => string }) {
  const last = row.last;
  if (!last) return <span className="text-muted">None yet</span>;
  return (
    <Link href={`/welfare/checks/${last.id}`} className="group flex flex-col items-start gap-1">
      <Badge tone={last.flags.includes('late') ? 'warn' : WELFARE_STATUS_TONE[last.status]}>
        {welfareStatusLabel(last.status)}
        {last.responseSeconds !== null ? ` in ${formatSeconds(last.responseSeconds)}` : ''}
      </Badge>
      <span className="text-xs text-muted group-hover:underline">
        {time(last.respondedAt ?? last.scheduledAt)}
        {last.flags.length ? ` · ${last.flags.map(responseFlagLabel).join(', ')}` : ''}
      </span>
    </Link>
  );
}

function NextCheck({ row, time }: { row: BoardRow; time: (iso: string) => string }) {
  if (row.pause) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge tone="warn">Paused</Badge>
        <span className="text-xs text-muted">
          {row.pause.reason}
          {row.pause.resumeAt ? ` · until ${time(row.pause.resumeAt)}` : ' · until resumed'}
        </span>
      </div>
    );
  }
  const open = row.open;
  if (open && open.status !== 'scheduled') {
    return (
      <Link href={`/welfare/checks/${open.id}`} className="group flex flex-col items-start gap-1">
        <Badge tone={WELFARE_STATUS_TONE[open.status]}>
          {open.status === 'escalated' && open.acknowledgedAt
            ? 'Escalated · acknowledged'
            : welfareStatusLabel(open.status)}
        </Badge>
        <span className="text-xs text-muted group-hover:underline">
          since {time(open.promptedAt ?? open.scheduledAt)} · open →
        </span>
      </Link>
    );
  }
  if (open) {
    return (
      <div className="flex flex-col">
        <Countdown at={open.scheduledAt} fallback={time(open.scheduledAt)} />
        <span className="text-xs text-muted">at {time(open.scheduledAt)}</span>
      </div>
    );
  }
  if (!row.checksEnabled) {
    return (
      <span className="text-muted">
        {WELFARE_POLICY_SOURCE_LABELS[row.policySource] ?? 'No checks'}
      </span>
    );
  }
  return <span className="text-muted">None before the shift ends</span>;
}
