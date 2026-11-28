import {
  formatDate,
  WELFARE_REPORT_PERIOD_LABELS,
  WELFARE_REPORT_PERIODS,
  welfareReportFiltersSchema,
} from '@deltaguard/shared';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';

import { Button, EmptyState, ErrorText, Select } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../schedule/data';
import {
  loadWelfareReport,
  percent,
  type ReportQuery,
  reportTotals,
  resolveReportQuery,
  type WelfareReportRow,
} from '../data';
import { formatSeconds } from '../labels';
import { WelfareTabs } from '../tabs';

export default function WelfareReportsPage({ searchParams }: PageProps<'/welfare/reports'>) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-muted">Loading the report…</p>}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** The query string for the export links (every default spelled out). */
function queryString(q: ReportQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    from: q.from,
    to: q.to,
    group: q.group,
    period: q.period,
    night_start: q.nightStart,
    night_end: q.nightEnd,
    ...(q.officer ? { officer: q.officer } : {}),
    ...(q.site ? { site: q.site } : {}),
    ...extra,
  });
  return params.toString();
}

async function Reports({
  searchParams,
}: {
  searchParams: PageProps<'/welfare/reports'>['searchParams'];
}) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  const filters = welfareReportFiltersSchema.parse(await searchParams);
  const q = await resolveReportQuery(supabase, filters, timeZone);

  const [report, officers, sites] = await Promise.all([
    loadWelfareReport(supabase, q).then(
      (rows) => ({ rows, error: null }),
      (e: Error) => ({ rows: [] as WelfareReportRow[], error: e.message }),
    ),
    supabase.from('profiles').select('id, full_name').eq('role', 'officer').order('full_name'),
    supabase.from('sites').select('id, name').order('name'),
  ]);
  const totals = reportTotals(report.rows);
  const byOfficer = q.group === 'officer';

  return (
    <>
      <WelfareTabs current="reports" isAdmin={staff.role === 'admin'} />

      <Form action="/welfare/reports" className="flex flex-wrap items-end gap-3 panel p-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">From</span>
          <input
            type="date"
            name="from"
            defaultValue={q.from}
            className="rounded-xl border border-line bg-surface px-2.5 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">To</span>
          <input
            type="date"
            name="to"
            defaultValue={q.to}
            className="rounded-xl border border-line bg-surface px-2.5 py-1.5"
          />
        </label>
        <Select label="Per" name="group" defaultValue={q.group}>
          <option value="officer">Officer</option>
          <option value="site">Site</option>
        </Select>
        <Select label="Hours" name="period" defaultValue={q.period}>
          {WELFARE_REPORT_PERIODS.map((p) => (
            <option key={p} value={p}>
              {WELFARE_REPORT_PERIOD_LABELS[p]}
            </option>
          ))}
        </Select>
        <fieldset className="flex items-end gap-2">
          <legend className="mb-1.5 text-sm font-medium">Night hours</legend>
          <input
            type="time"
            name="night_start"
            defaultValue={q.nightStart}
            aria-label="Night starts"
            className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm"
          />
          <span className="pb-2 text-sm text-muted">to</span>
          <input
            type="time"
            name="night_end"
            defaultValue={q.nightEnd}
            aria-label="Night ends"
            className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm"
          />
        </fieldset>
        <Select label="Officer" name="officer" defaultValue={q.officer ?? ''}>
          <option value="">All officers</option>
          {(officers.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name ?? 'Unnamed'}
            </option>
          ))}
        </Select>
        <Select label="Site" name="site" defaultValue={q.site ?? ''}>
          <option value="">All sites</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button type="submit">Show</Button>
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {formatDate(q.from)} to {formatDate(q.to)} · {WELFARE_REPORT_PERIOD_LABELS[q.period]}
          {q.period !== 'all' ? ` (night = ${q.nightStart} to ${q.nightEnd})` : ''} · company time
          {staff.role === 'supervisor' ? ' · your sites only' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/welfare/reports/export?${queryString(q, { kind: 'summary' })}`}
            className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Export totals (CSV)
          </a>
          <a
            href={`/welfare/reports/export?${queryString(q, { kind: 'checks' })}`}
            className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Export every check (CSV)
          </a>
        </div>
      </div>

      {report.error ? (
        <ErrorText>{report.error}</ErrorText>
      ) : report.rows.length === 0 ? (
        <EmptyState>No welfare checks came due in this range.</EmptyState>
      ) : (
        <div className="overflow-x-auto panel px-2 py-1 sm:px-3">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-3 py-3 font-medium">{byOfficer ? 'Officer' : 'Site'}</th>
                <th className="px-3 py-3 text-right font-medium">Prompted</th>
                <th className="px-3 py-3 text-right font-medium">Answered</th>
                <th className="px-3 py-3 text-right font-medium">Late</th>
                <th className="px-3 py-3 text-right font-medium">Missed</th>
                <th className="px-3 py-3 text-right font-medium">Escalated</th>
                <th className="px-3 py-3 text-right font-medium">Avg response</th>
                <th className="px-3 py-3 text-right font-medium">Slowest</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-line">
              {report.rows.map((r) => (
                <tr key={r.group_id}>
                  <td className="px-3 py-3 font-medium">
                    <Link
                      href={
                        byOfficer ? `/officers/${r.group_id}?tab=welfare` : `/sites/${r.group_id}`
                      }
                      className="hover:underline"
                    >
                      {r.group_name ?? 'Unnamed'}
                    </Link>
                  </td>
                  <Numbers
                    prompted={r.prompted}
                    answered={r.answered}
                    late={r.answered_late}
                    missed={r.missed}
                    escalated={r.escalated}
                    avg={r.avg_response_seconds === null ? null : Number(r.avg_response_seconds)}
                    max={r.max_response_seconds}
                  />
                </tr>
              ))}
              {report.rows.length > 1 ? (
                <tr className="font-semibold">
                  <td className="px-3 py-3">Total</td>
                  <Numbers
                    prompted={totals.prompted}
                    answered={totals.answered}
                    late={totals.answered_late}
                    missed={totals.missed}
                    escalated={totals.escalated}
                    avg={totals.avg_response_seconds}
                    max={totals.max_response_seconds}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Prompted: checks that came due. Missed: escalated, or closed by staff, without an answer in
        time. Checks cancelled by clock-out or a pause are not counted. Average response counts
        answered checks only.
      </p>
    </>
  );
}

function Numbers(n: {
  prompted: number;
  answered: number;
  late: number;
  missed: number;
  escalated: number;
  avg: number | null;
  max: number | null;
}) {
  const cell = 'px-3 py-3 text-right tabular-nums';
  return (
    <>
      <td className={cell}>{n.prompted}</td>
      <td className={cell}>
        {n.answered} <span className="text-xs text-muted">({percent(n.answered, n.prompted)})</span>
      </td>
      <td className={`${cell} ${n.late ? 'text-amber-700 dark:text-amber-400' : ''}`}>{n.late}</td>
      <td className={`${cell} ${n.missed ? 'text-red-700 dark:text-red-400' : ''}`}>{n.missed}</td>
      <td className={`${cell} ${n.escalated ? 'text-red-700 dark:text-red-400' : ''}`}>
        {n.escalated}
      </td>
      <td className={cell}>{formatSeconds(n.avg)}</td>
      <td className={cell}>{formatSeconds(n.max)}</td>
    </>
  );
}
