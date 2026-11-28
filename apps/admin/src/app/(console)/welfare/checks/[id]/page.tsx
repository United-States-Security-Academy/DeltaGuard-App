import { toZoned } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { Badge, Card, ErrorText, Table } from '@/components/ui';
import { WelfareActions } from '@/components/welfare-actions';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { formatWhen } from '../../../incidents/data';
import { getTimeZone } from '../../../schedule/data';
import { LiveRefresh, type LiveTable } from '../../../schedule/live-refresh';
import {
  describeWelfareStep,
  formatSeconds,
  responseFlagLabel,
  WELFARE_STATUS_TONE,
  WELFARE_STEP_LABELS,
  welfareStatusLabel,
} from '../../labels';
import { loadFailed } from '@/lib/server-errors';

const LIVE_TABLES: LiveTable[] = [{ table: 'welfare_checks', event: 'UPDATE' }];

export default function WelfareCheckPage({ params }: PageProps<'/welfare/checks/[id]'>) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/welfare" className="text-sm text-muted hover:underline">
        ← Welfare board
      </Link>
      <Suspense fallback={<p className="text-muted">Loading the check…</p>}>
        <CheckDetail params={params} />
      </Suspense>
    </div>
  );
}

type LogEntry = Record<string, unknown> & { at?: string; step?: string };

async function CheckDetail({ params }: { params: PageProps<'/welfare/checks/[id]'>['params'] }) {
  await requireStaff();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);

  const [check, outbox] = await Promise.all([
    supabase
      .from('welfare_checks')
      .select(
        `*, officer:profiles!welfare_checks_officer_id_fkey(id, full_name, phone),
         resolver:profiles!welfare_checks_resolved_by_fkey(full_name),
         acknowledger:profiles!welfare_checks_acknowledged_by_fkey(full_name),
         sites(id, name), shifts(id, starts_at, ends_at)`,
      )
      .eq('id', id.data)
      .maybeSingle(),
    supabase
      .from('welfare_outbox')
      .select(
        'id, kind, attempt_no, recipient_name, phone, status, attempts, error, sent_at, created_at',
      )
      .eq('check_id', id.data)
      .order('created_at'),
  ]);
  if (check.error) return <ErrorText>{loadFailed('the check', check.error)}</ErrorText>;
  const c = check.data;
  if (!c) notFound();

  const when = (iso: string | null) => (iso ? formatWhen(iso, timeZone) : '—');
  const log = (Array.isArray(c.escalation_log) ? c.escalation_log : []) as LogEntry[];
  const policy = (c.policy ?? {}) as Record<string, unknown>;
  const officerName = c.officer?.full_name ?? 'Officer';
  const open = ['prompted', 'alarm', 'calling', 'escalated'].includes(c.status);

  return (
    <>
      {open ? (
        <LiveRefresh
          renderedAt={toZoned(new Date(), timeZone).time}
          channel={`welfare-check-${c.id}`}
          tables={LIVE_TABLES}
        />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Welfare check: {officerName}</h1>
          <p className="mt-1 text-muted">
            {c.sites?.name ?? 'Unknown site'} · due {when(c.scheduled_at)}
            {c.shifts ? (
              <>
                {' · '}
                <Link href={`/schedule/${c.shift_id}`} className="underline">
                  shift
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <Badge tone={WELFARE_STATUS_TONE[c.status]}>
          {welfareStatusLabel(c.status)}
          {c.status === 'escalated' && c.acknowledged_at ? ' · acknowledged' : ''}
        </Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Officer</dt>
            <dd>
              <Link href={`/officers/${c.officer_id}?tab=welfare`} className="underline">
                {officerName}
              </Link>
              {c.officer?.phone ? (
                <>
                  {' · '}
                  <a href={`tel:${c.officer.phone}`} className="underline">
                    {c.officer.phone}
                  </a>
                </>
              ) : null}
            </dd>
            <dt className="text-muted">Prompted</dt>
            <dd>{when(c.prompted_at)}</dd>
            <dt className="text-muted">Answered</dt>
            <dd>
              {c.responded_at ? (
                <>
                  {when(c.responded_at)} after {formatSeconds(c.response_seconds)}
                  {c.biometric_verified ? ' · biometric confirmed' : ''}
                  {c.response_flags.length ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.response_flags.map((f) => (
                        <Badge key={f} tone="warn">
                          {responseFlagLabel(f)}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </>
              ) : (
                'No answer'
              )}
            </dd>
            <dt className="text-muted">Automated calls</dt>
            <dd>{c.calls_made}</dd>
            <dt className="text-muted">Acknowledged</dt>
            <dd>
              {c.acknowledged_at
                ? `${when(c.acknowledged_at)} by ${c.acknowledger?.full_name ?? 'staff'}`
                : '—'}
            </dd>
            <dt className="text-muted">Resolved</dt>
            <dd>
              {c.resolved_at
                ? `${when(c.resolved_at)} by ${c.resolver?.full_name ?? 'staff'}`
                : '—'}
              {c.resolution_notes ? (
                <span className="block text-muted">{c.resolution_notes}</span>
              ) : null}
            </dd>
            <dt className="text-muted">Policy</dt>
            <dd>
              {typeof policy.name === 'string' ? policy.name : '—'}
              {typeof policy.response_seconds === 'number'
                ? ` · ${formatSeconds(policy.response_seconds)} to answer`
                : ''}
              {policy.night === true ? ' · night interval' : ''}
            </dd>
          </dl>
        </Card>

        {open ? (
          <Card title="Respond">
            <WelfareActions
              checkId={c.id}
              status={c.status}
              acknowledged={c.acknowledged_at !== null}
              officerPhone={c.officer?.phone ?? null}
            />
          </Card>
        ) : null}
      </div>

      <Card title="Log">
        <ol className="flex flex-col">
          {log.map((e, i) => {
            const step = typeof e.step === 'string' ? e.step : 'unknown';
            const details = describeWelfareStep(e);
            const bad = step.endsWith('_failed') || step === 'escalated';
            return (
              <li
                key={i}
                className="flex gap-4 border-t border-line py-2.5 text-sm first:border-t-0"
              >
                <time className="w-40 shrink-0 text-muted tabular-nums">
                  {typeof e.at === 'string' ? when(e.at) : '—'}
                </time>
                <div className="min-w-0">
                  <p className={`font-medium ${bad ? 'text-red-700 dark:text-red-400' : ''}`}>
                    {WELFARE_STEP_LABELS[step] ?? step}
                  </p>
                  {details ? <p className="text-xs break-words text-muted">{details}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {outbox.data && outbox.data.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Calls and messages</h2>
          <Table head={['Type', 'To', 'Status', 'Tries', 'Sent', 'Error']}>
            {outbox.data.map((o) => (
              <tr key={o.id}>
                <td className="px-3 py-3">{o.kind === 'call' ? `Call ${o.attempt_no}` : 'SMS'}</td>
                <td className="px-3 py-3">
                  {o.recipient_name ?? '—'} <span className="text-muted">{o.phone}</span>
                </td>
                <td className="px-3 py-3 capitalize">{o.status}</td>
                <td className="px-3 py-3 tabular-nums">{o.attempts}</td>
                <td className="px-3 py-3">{when(o.sent_at)}</td>
                <td className="px-3 py-3 text-xs text-muted">{o.error ?? ''}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}
    </>
  );
}
