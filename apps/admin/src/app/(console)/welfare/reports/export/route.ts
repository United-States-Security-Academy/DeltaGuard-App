import {
  toZoned,
  WELFARE_REPORT_PERIOD_LABELS,
  welfareReportFiltersSchema,
} from '@deltaguard/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auditFailed, exportBlocked, recordAudit } from '@/lib/audit';
import { getStaffSession } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../../schedule/data';
import { loadWelfareCheckRows, loadWelfareReport, resolveReportQuery } from '../../data';
import { responseFlagLabel, welfareStatusLabel } from '../../labels';

const kindSchema = z.enum(['summary', 'checks']).catch('summary');

/**
 * GET /welfare/reports/export?kind=summary|checks&<report filters>: the report
 * as CSV. The SQL functions run with the caller's session, so supervisors get
 * their own sites only.
 */
export async function GET(request: Request) {
  if (!(await getStaffSession())) return new NextResponse('Not allowed', { status: 403 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const kind = kindSchema.parse(params.kind);

  const supabase = await createClient();
  const blocked = await exportBlocked(supabase);
  if (blocked) return blocked;
  const timeZone = await getTimeZone(supabase);
  const q = await resolveReportQuery(supabase, welfareReportFiltersSchema.parse(params), timeZone);

  const when = (iso: string | null) => {
    if (!iso) return '';
    const z = toZoned(iso, timeZone);
    return `${z.date} ${z.time}`;
  };
  const avg = (v: number | string | null) => (v === null ? '' : Math.round(Number(v)));

  let rows: (string | number | boolean | null)[][];
  try {
    if (kind === 'summary') {
      const report = await loadWelfareReport(supabase, q);
      rows = [
        [
          q.group === 'officer' ? 'Officer' : 'Site',
          'Prompted',
          'Answered',
          'Answered %',
          'Answered late',
          'Missed',
          'Escalated',
          'Avg response (s)',
          'Slowest response (s)',
        ],
        ...report.map((r) => [
          r.group_name ?? '',
          r.prompted,
          r.answered,
          r.prompted ? Math.round((r.answered / r.prompted) * 100) : '',
          r.answered_late,
          r.missed,
          r.escalated,
          avg(r.avg_response_seconds),
          r.max_response_seconds ?? '',
        ]),
      ];
    } else {
      const checks = await loadWelfareCheckRows(supabase, q);
      rows = [
        [
          'Due (company time)',
          'Night',
          'Officer',
          'Site',
          'Status',
          'Answered at',
          'Response (s)',
          'Flags',
          'Missed',
          'Escalated',
          'Automated calls',
          'Acknowledged at',
          'Resolved at',
          'Resolved by',
          'Resolution notes',
          'Policy',
          'Check id',
        ],
        ...checks.map((c) => [
          when(c.due_at),
          c.is_night ? 'yes' : 'no',
          c.officer_name ?? '',
          c.site_name ?? '',
          welfareStatusLabel(c.status),
          when(c.responded_at),
          c.response_seconds ?? '',
          (c.response_flags ?? []).map(responseFlagLabel).join('; '),
          c.missed ? 'yes' : 'no',
          c.escalated ? 'yes' : 'no',
          c.calls_made,
          when(c.acknowledged_at),
          when(c.resolved_at),
          c.resolved_by_name ?? '',
          c.resolution_notes ?? '',
          c.policy_name ?? '',
          c.check_id,
        ]),
      ];
    }
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 500 });
  }

  const audited = await recordAudit(
    supabase,
    'report_export',
    { type: 'welfare_report', id: `${q.from}..${q.to}` },
    {
      kind,
      group: q.group,
      period: q.period,
      officer: q.officer ?? null,
      site: q.site ?? null,
      rows: rows.length - 1,
    },
  );
  if (!audited) return auditFailed();

  const period =
    q.period === 'all' ? '' : ` ${WELFARE_REPORT_PERIOD_LABELS[q.period].toLowerCase()}`;
  const name =
    kind === 'summary'
      ? `Welfare checks per ${q.group} ${q.from} to ${q.to}${period}.csv`
      : `Welfare checks ${q.from} to ${q.to}${period}.csv`;
  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
