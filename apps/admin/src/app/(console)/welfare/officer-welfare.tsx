import { addDaysIso, formatDate, todayInZone } from '@deltaguard/shared';
import Link from 'next/link';

import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState, ErrorText } from '@/components/ui';
import type { createClient } from '@/lib/supabase/server';

import { formatWhen } from '../incidents/data';
import { OfficerWelfareSettingForm } from './officer-setting-forms';
import { getTimeZone } from '../schedule/data';
import { loadWelfareCheckRows, loadWelfareReport, percent, resolveReportQuery } from './data';
import {
  formatSeconds,
  responseFlagLabel,
  WELFARE_STATUS_TONE,
  welfareStatusLabel,
} from './labels';
import { caughtMessage } from '@/lib/server-errors';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const DAYS = 30;
const RECENT = 50;

/** Officer profile tab: the last 30 days of welfare checks (RLS scopes supervisors). */
export async function OfficerWelfare({
  supabase,
  officerId,
  isAdmin,
}: {
  supabase: Supabase;
  officerId: string;
  isAdmin: boolean;
}) {
  await requireStaff(); // each data-loading component checks access itself
  const timeZone = await getTimeZone(supabase);
  const today = todayInZone(timeZone);
  const q = await resolveReportQuery(
    supabase,
    {
      from: addDaysIso(today, -(DAYS - 1)),
      to: today,
      group: 'officer',
      period: 'all',
      officer: officerId,
    },
    timeZone,
  );

  let summary, rows;
  const [own, policies] = await Promise.all([
    supabase
      .from('officer_welfare_settings')
      .select('mode, policy_id, welfare_check_policies(name)')
      .eq('officer_id', officerId)
      .maybeSingle(),
    supabase.from('welfare_check_policies').select('id, name, enabled').order('name'),
  ]);
  const current = !own.data ? 'inherit' : own.data.mode === 'off' ? 'off' : own.data.policy_id!;
  const currentLabel = !own.data
    ? 'Follows their site’s policy (or the company default)'
    : own.data.mode === 'off'
      ? 'No welfare checks for this officer'
      : `Own policy: ${own.data.welfare_check_policies?.name ?? 'unknown'}`;
  try {
    [summary, rows] = await Promise.all([
      loadWelfareReport(supabase, q),
      loadWelfareCheckRows(supabase, q),
    ]);
  } catch (e) {
    return <ErrorText>{caughtMessage(e)}</ErrorText>;
  }
  const s = summary[0];
  const recent = [...rows].reverse().slice(0, RECENT);
  const when = (iso: string | null) => (iso ? formatWhen(iso, timeZone) : '—');
  const stats = s
    ? [
        { label: 'Prompted', value: String(s.prompted) },
        { label: 'Answered', value: `${s.answered} (${percent(s.answered, s.prompted)})` },
        { label: 'Answered late', value: String(s.answered_late), warn: s.answered_late > 0 },
        { label: 'Missed', value: String(s.missed), bad: s.missed > 0 },
        { label: 'Escalated', value: String(s.escalated), bad: s.escalated > 0 },
        {
          label: 'Avg response',
          value: formatSeconds(
            s.avg_response_seconds === null ? null : Number(s.avg_response_seconds),
          ),
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Card title="Setting">
        {isAdmin ? (
          <OfficerWelfareSettingForm
            officerId={officerId}
            current={current}
            policies={policies.data ?? []}
          />
        ) : (
          <p className="text-sm">{currentLabel}</p>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Last {DAYS} days ({formatDate(q.from)} to {formatDate(q.to)})
        </p>
        <Link
          href={`/welfare/reports?officer=${officerId}`}
          className="text-sm font-medium text-accent-ink hover:underline"
        >
          Full report and CSV →
        </Link>
      </div>

      {!s ? (
        <EmptyState>No welfare checks came due in the last {DAYS} days.</EmptyState>
      ) : (
        <>
          <dl className="flex flex-wrap gap-3">
            {stats.map((st) => (
              <div key={st.label} className="min-w-32 flex-1 panel px-4 py-3">
                <dt className="text-xs text-muted">{st.label}</dt>
                <dd
                  className={`text-2xl font-semibold tabular-nums ${
                    'bad' in st && st.bad
                      ? 'text-red-700 dark:text-red-400'
                      : 'warn' in st && st.warn
                        ? 'text-amber-700 dark:text-amber-400'
                        : ''
                  }`}
                >
                  {st.value}
                </dd>
              </div>
            ))}
          </dl>

          <Card title={`Recent checks${rows.length > RECENT ? ` (latest ${RECENT})` : ''}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2.5 pr-3 font-medium">Due</th>
                    <th className="px-3 py-2.5 font-medium">Site</th>
                    <th className="px-3 py-2.5 font-medium">Result</th>
                    <th className="px-3 py-2.5 font-medium">Answered after</th>
                    <th className="px-3 py-2.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-b-0">
                  {recent.map((r) => (
                    <tr key={r.check_id} className="align-top">
                      <td className="py-2.5 pr-3 tabular-nums">
                        <Link href={`/welfare/checks/${r.check_id}`} className="hover:underline">
                          {when(r.due_at)}
                        </Link>
                        {r.is_night ? (
                          <span className="ml-1.5 text-xs text-muted">night</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/schedule/${r.shift_id}`} className="hover:underline">
                          {r.site_name ?? '—'}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={r.missed ? 'bad' : WELFARE_STATUS_TONE[r.status]}>
                            {r.missed ? 'Missed' : welfareStatusLabel(r.status)}
                          </Badge>
                          {r.escalated && !r.missed ? <Badge tone="bad">Escalated</Badge> : null}
                          {(r.response_flags ?? []).map((f) => (
                            <Badge key={f} tone="warn">
                              {responseFlagLabel(f)}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatSeconds(r.response_seconds)}
                      </td>
                      <td className="px-3 py-2.5 text-muted">{r.resolution_notes ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
