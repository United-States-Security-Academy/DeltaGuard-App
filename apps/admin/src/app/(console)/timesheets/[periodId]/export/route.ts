import { decimalHours, firstParam } from '@deltaguard/shared';
import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auditFailed, exportBlocked, recordAudit } from '@/lib/audit';
import { getStaffSession, hasRecentMfa, reauthUrl } from '@/lib/auth';
import { csvCell, neutralizeFormula } from '@/lib/csv';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../../schedule/data';
import { type Entry, loadEntries, loadPeriods } from '../../data';
import { PAYROLL_COLUMNS, type PayrollCell } from '../../payroll-columns';

/**
 * GET /timesheets/<period id>/export?format=csv|xlsx
 * Payroll export of a LOCKED pay period (locking requires every entry to be
 * approved, so a locked period is final). Columns: payroll-columns.ts.
 * Loaded as the signed-in staff member, so RLS applies.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/timesheets/[periodId]/export'>,
) {
  const session = await getStaffSession();
  if (!session) return new NextResponse('Not allowed', { status: 403 });
  // Payroll export: the authenticator code must have been entered recently.
  if (!hasRecentMfa(session)) {
    const url = new URL(request.url);
    return NextResponse.redirect(new URL(reauthUrl(url.pathname + url.search), url), 303);
  }

  const periodId = z.uuid().safeParse((await params).periodId);
  const format = z
    .enum(['csv', 'xlsx'])
    .catch('csv')
    .parse(firstParam(new URL(request.url).searchParams.getAll('format')));
  if (!periodId.success) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const period = (await loadPeriods(supabase)).find((p) => p.id === periodId.data);
  if (!period) return new NextResponse('Not found', { status: 404 });
  if (period.status !== 'locked') {
    return new NextResponse('Only locked pay periods can be exported', { status: 409 });
  }

  const blocked = await exportBlocked(supabase);
  if (blocked) return blocked;

  const timeZone = await getTimeZone(supabase);
  const entries = (await loadEntries(supabase, period))
    .filter((e) => e.status === 'approved')
    .sort(
      (a, b) =>
        (a.officer?.full_name ?? '').localeCompare(b.officer?.full_name ?? '') ||
        a.work_date.localeCompare(b.work_date),
    );
  const rows = entries.map((e) => PAYROLL_COLUMNS.map((c) => c.value(e, { timeZone })));
  const name = `deltacon-payroll-${period.starts_on}-to-${period.ends_on}`;
  const headers = { 'Cache-Control': 'no-store' };
  const audited = await recordAudit(
    supabase,
    'payroll_export',
    { type: 'pay_period', id: period.id },
    { format, entries: entries.length, starts_on: period.starts_on, ends_on: period.ends_on },
  );
  if (!audited) return auditFailed();

  if (format === 'csv') {
    const lines = [PAYROLL_COLUMNS.map((c) => c.header), ...rows].map((r) =>
      r.map(payrollCsvCell).join(','),
    );
    // BOM so Excel opens UTF-8 (names with accents) correctly.
    return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
      headers: {
        ...headers,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}.csv"`,
      },
    });
  }

  const buffer = await xlsx(rows, entries, period.starts_on, period.ends_on);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      ...headers,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}.xlsx"`,
    },
  });
}

/** CSV cell (RFC 4180, formula-safe: lib/csv.ts). */
function payrollCsvCell(value: PayrollCell): string {
  return csvCell(value);
}

async function xlsx(
  rows: PayrollCell[][],
  entries: Entry[],
  startsOn: string,
  endsOn: string,
): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'DeltaGuard';
  book.created = new Date();

  const sheet = book.addWorksheet('Timesheet', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = PAYROLL_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    // ExcelJS writes strings as text cells, never formulas; text that looks
    // like a formula is still made inert, in case the sheet is saved as CSV.
    sheet.addRow(row.map((v) => (typeof v === 'string' ? neutralizeFormula(v) : (v ?? ''))));
  }
  PAYROLL_COLUMNS.forEach((c, i) => {
    if (c.header === 'Worked hours') sheet.getColumn(i + 1).numFmt = '0.00';
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: PAYROLL_COLUMNS.length },
  };

  // Totals per officer.
  const totals = book.addWorksheet('Totals', { views: [{ state: 'frozen', ySplit: 1 }] });
  totals.columns = [
    { header: 'Employee number', width: 16 },
    { header: 'Officer', width: 26 },
    { header: 'Shifts', width: 8 },
    { header: 'Worked minutes', width: 14 },
    { header: 'Worked hours', width: 12 },
  ];
  totals.getRow(1).font = { bold: true };
  const byOfficer = new Map<
    string,
    { number: string; name: string; shifts: number; minutes: number }
  >();
  for (const e of entries) {
    const t = byOfficer.get(e.officer_id) ?? {
      number: e.officer?.officer_details?.employee_number ?? '',
      name: e.officer?.full_name ?? '',
      shifts: 0,
      minutes: 0,
    };
    t.shifts += 1;
    t.minutes += e.worked_minutes ?? 0;
    byOfficer.set(e.officer_id, t);
  }
  for (const t of [...byOfficer.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    totals.addRow([
      neutralizeFormula(t.number),
      neutralizeFormula(t.name),
      t.shifts,
      t.minutes,
      decimalHours(t.minutes),
    ]);
  }
  totals.getColumn(5).numFmt = '0.00';
  totals.addRow([]);
  totals.addRow([`Pay period ${startsOn} to ${endsOn}`]);

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
