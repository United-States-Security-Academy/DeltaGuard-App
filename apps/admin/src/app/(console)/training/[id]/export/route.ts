import { recordIdSchema, toZoned } from '@deltaguard/shared';
import { NextResponse } from 'next/server';

import { auditFailed, exportBlocked, recordAudit } from '@/lib/audit';
import { getStaffSession } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { createClient } from '@/lib/supabase/server';

import { safeFileName } from '../../../forms/data';
import { getTimeZone } from '../../../schedule/data';
import { RESULT_STATUS_LABELS, type ResultStatus } from '../../labels';

/** GET /training/<lesson id>/export: the results table as CSV (RLS scopes supervisors). */
export async function GET(_request: Request, { params }: RouteContext<'/training/[id]/export'>) {
  if (!(await getStaffSession())) return new NextResponse('Not allowed', { status: 403 });
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const blocked = await exportBlocked(supabase);
  if (blocked) return blocked;
  const [{ data: lesson }, results, timeZone] = await Promise.all([
    supabase.from('lessons').select('title').eq('id', id.data.id).maybeSingle(),
    supabase.rpc('lesson_results', { p_lesson_id: id.data.id }),
    getTimeZone(supabase),
  ]);
  if (!lesson) return new NextResponse('Not found', { status: 404 });
  if (results.error) return new NextResponse('Could not load results', { status: 500 });

  const when = (iso: string | null) => {
    if (!iso) return '';
    const z = toZoned(iso, timeZone);
    return `${z.date} ${z.time}`;
  };
  const rows = [
    [
      'Officer',
      'Status',
      'Overdue',
      'Due',
      'Pages viewed',
      'Pages',
      'Minutes reading',
      'Reading completed',
      'Attempts',
      'Attempts allowed',
      'Best score %',
      'Passed at',
    ],
    ...results.data.map((r) => [
      r.officer_name ?? '',
      RESULT_STATUS_LABELS[r.status as ResultStatus] ?? r.status,
      r.overdue ? 'yes' : 'no',
      when(r.due_at),
      r.pages_viewed,
      r.page_count,
      Math.round(r.seconds_spent / 6) / 10,
      when(r.completed_reading_at),
      r.attempts,
      r.attempts_allowed ?? 'unlimited',
      r.best_score === null ? '' : Number(r.best_score),
      when(r.passed_at),
    ]),
  ];

  if (
    !(await recordAudit(
      supabase,
      'report_export',
      { type: 'lesson_results', id: id.data.id },
      { rows: results.data.length },
    ))
  ) {
    return auditFailed();
  }

  const stamp = toZoned(new Date(), timeZone).date;
  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFileName(lesson.title)} results ${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
