import type { ShiftStatus } from '@deltaguard/shared';
import Link from 'next/link';

import { Badge, Card, ErrorText } from '@/components/ui';
import type { createClient } from '@/lib/supabase/server';

import { formatWhen } from '../incidents/data';
import {
  formatSeconds,
  responseFlagLabel,
  WELFARE_STATUS_TONE,
  welfareStatusLabel,
} from './labels';
import { PauseControl } from './pause-control';
import { loadFailed } from '@/lib/server-errors';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Shift detail: every welfare check on the shift, pauses (audit trail) and pause controls. */
export async function ShiftWelfare({
  supabase,
  shiftId,
  shiftStatus,
  timeZone,
  isAdmin,
}: {
  supabase: Supabase;
  shiftId: string;
  shiftStatus: ShiftStatus;
  timeZone: string;
  isAdmin: boolean;
}) {
  const [checks, pauses] = await Promise.all([
    supabase
      .from('welfare_checks')
      .select(
        'id, status, scheduled_at, prompted_at, responded_at, response_seconds, response_flags, calls_made, resolution_notes, escalation_log',
      )
      .eq('shift_id', shiftId)
      .order('scheduled_at'),
    supabase
      .from('welfare_pauses')
      .select(
        'id, reason, paused_at, paused_by_name, resume_at, resumed_at, resumed_by_name, resume_reason',
      )
      .eq('shift_id', shiftId)
      .order('paused_at'),
  ]);
  if (checks.error) {
    return (
      <Card title="Welfare checks">
        <ErrorText>{loadFailed('welfare checks', checks.error)}</ErrorText>
      </Card>
    );
  }
  const when = (iso: string | null) => (iso ? formatWhen(iso, timeZone) : '—');
  const openPause = (pauses.data ?? []).find((p) => p.resumed_at === null) ?? null;
  const pausedByCancel = (log: unknown) =>
    Array.isArray(log) &&
    log.some(
      (e) =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).reason === 'paused',
    );
  const shown = checks.data.filter(
    (c) => c.status !== 'cancelled' || c.prompted_at || pausedByCancel(c.escalation_log),
  );

  return (
    <Card
      title="Welfare checks"
      actions={
        shown.length ? (
          <span className="text-sm text-muted">
            {checks.data.filter((c) => c.responded_at).length} answered ·{' '}
            {checks.data.filter((c) => c.status === 'escalated' || c.status === 'resolved').length}{' '}
            escalated or closed by staff
          </span>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        {shown.length === 0 ? (
          <p className="text-sm text-muted">
            {shiftStatus === 'in_progress'
              ? 'No welfare checks yet on this shift.'
              : 'No welfare checks on this shift.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2.5 pr-3 font-medium">Due</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                  <th className="px-3 py-2.5 font-medium">Answered after</th>
                  <th className="px-3 py-2.5 font-medium">Calls</th>
                  <th className="px-3 py-2.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-b-0">
                {shown.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="py-2.5 pr-3 tabular-nums">
                      <Link href={`/welfare/checks/${c.id}`} className="hover:underline">
                        {when(c.prompted_at ?? c.scheduled_at)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={WELFARE_STATUS_TONE[c.status]}>
                          {c.status === 'cancelled' && pausedByCancel(c.escalation_log)
                            ? 'Cancelled (paused)'
                            : welfareStatusLabel(c.status)}
                        </Badge>
                        {c.response_flags.map((f) => (
                          <Badge key={f} tone="warn">
                            {responseFlagLabel(f)}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {formatSeconds(c.response_seconds)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{c.calls_made || '—'}</td>
                    <td className="px-3 py-2.5 text-muted">{c.resolution_notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(pauses.data ?? []).length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Pauses</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {(pauses.data ?? []).map((p) => (
                <li key={p.id} className="rounded-xl bg-surface-2 px-3 py-2">
                  <span className="font-medium">{p.reason}</span>
                  <span className="text-muted">
                    {' '}
                    · paused {when(p.paused_at)} by {p.paused_by_name ?? 'an admin'}
                    {p.resumed_at
                      ? p.resume_reason === 'manual'
                        ? ` · resumed ${when(p.resumed_at)} by ${p.resumed_by_name ?? 'an admin'}`
                        : p.resume_reason === 'scheduled'
                          ? ` · resumed automatically ${when(p.resumed_at)}`
                          : ` · ended with the shift ${when(p.resumed_at)}`
                      : p.resume_at
                        ? ` · until ${when(p.resume_at)}`
                        : ' · until resumed'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {isAdmin && shiftStatus === 'in_progress' ? (
          <div className="border-t border-line pt-4">
            {openPause ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm">Checks are paused for this shift.</p>
                <PauseControl shiftId={shiftId} paused />
              </div>
            ) : (
              <PauseControl shiftId={shiftId} paused={false} />
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
