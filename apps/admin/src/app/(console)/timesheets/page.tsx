import {
  addDaysIso,
  decimalHours,
  firstParam,
  formatDate,
  formatDayShort,
  formatMinutes,
  todayInZone,
} from '@deltaguard/shared';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';

import { ActionButton } from '@/components/action-form';
import { Badge, Button, Card, EmptyState, ErrorText, Select, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../schedule/data';
import { deletePayPeriod, lockPayPeriod } from './actions';
import { attention, type Entry, loadEntries, loadPeriods, pickPeriod, zoned } from './data';
import { type GridRow, TimesheetGrid } from './grid';
import { NewPeriodForm } from './new-period-form';

const filtersSchema = z.object({
  period: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  site: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  officer: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  flagged: z.preprocess(firstParam, z.literal('1').optional()).catch(undefined),
  // Awaiting approval only (linked from the dashboard).
  pending: z.preprocess(firstParam, z.literal('1').optional()).catch(undefined),
});

export default function TimesheetsPage({ searchParams }: PageProps<'/timesheets'>) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Timesheets</h1>
      <Suspense fallback={<p className="text-slate-500">Loading timesheets…</p>}>
        <TimesheetsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function TimesheetsContent({
  searchParams,
}: {
  searchParams: PageProps<'/timesheets'>['searchParams'];
}) {
  const staff = await requireStaff();
  const isAdmin = staff.role === 'admin';
  const f = filtersSchema.parse(await searchParams);
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);

  let periods;
  try {
    periods = await loadPeriods(supabase);
  } catch (e) {
    return <ErrorText>Could not load pay periods: {(e as Error).message}</ErrorText>;
  }
  const period = pickPeriod(periods, f.period, timeZone);

  if (!period) {
    return (
      <Card title="Pay periods">
        {isAdmin ? (
          <NewPeriodForm />
        ) : (
          <EmptyState>No pay periods yet. An admin needs to create one.</EmptyState>
        )}
      </Card>
    );
  }

  let entries: Entry[];
  try {
    entries = await loadEntries(supabase, period);
  } catch (e) {
    return <ErrorText>Could not load the timesheet: {(e as Error).message}</ErrorText>;
  }
  const locked = period.status === 'locked';
  const ended = period.ends_on < todayInZone(timeZone);

  // Filter options come from the whole period, before filtering.
  const siteOptions = uniqueBy(
    entries,
    (e) => e.site_id,
    (e) => e.sites?.name ?? 'Site',
  );
  const officerOptions = uniqueBy(
    entries,
    (e) => e.officer_id,
    (e) => e.officer?.full_name ?? 'Officer',
  );
  const rows = entries.filter(
    (e) =>
      (!f.site || e.site_id === f.site) &&
      (!f.officer || e.officer_id === f.officer) &&
      (!f.flagged || attention(e).length > 0) &&
      (!f.pending || e.status === 'pending'),
  );
  const pendingInPeriod = entries.filter((e) => e.status !== 'approved').length;

  // Totals per officer (filtered rows).
  const totals = new Map<
    string,
    {
      name: string;
      number: string | null;
      shifts: number;
      minutes: number;
      approved: number;
      pending: number;
    }
  >();
  for (const e of rows) {
    const t = totals.get(e.officer_id) ?? {
      name: e.officer?.full_name ?? 'Officer',
      number: e.officer?.officer_details?.employee_number ?? null,
      shifts: 0,
      minutes: 0,
      approved: 0,
      pending: 0,
    };
    t.shifts += 1;
    t.minutes += e.worked_minutes ?? 0;
    if (e.status === 'approved') t.approved += e.worked_minutes ?? 0;
    else t.pending += 1;
    totals.set(e.officer_id, t);
  }
  const totalRows = [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));

  const gridRows: GridRow[] = rows.map((e) => toGridRow(e, timeZone, staff.userId, locked));
  const query = (extra: Record<string, string>) =>
    new URLSearchParams({ period: period.id, ...extra }).toString();

  return (
    <>
      <Card
        title={`Pay period ${formatDate(period.starts_on)} – ${formatDate(period.ends_on)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={locked ? 'good' : 'warn'}>{locked ? 'Locked' : 'Open'}</Badge>
            {locked ? (
              <>
                <a
                  href={`/timesheets/${period.id}/export?format=csv`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Export CSV
                </a>
                <a
                  href={`/timesheets/${period.id}/export?format=xlsx`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Export XLSX
                </a>
              </>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Form action="/timesheets" className="flex flex-wrap items-end gap-3">
            <Select label="Pay period" name="period" defaultValue={period.id}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatDate(p.starts_on)} – {formatDate(p.ends_on)}
                  {p.status === 'locked' ? ' (locked)' : ''}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </Form>

          {locked ? (
            <p className="text-sm text-slate-500">
              Locked {period.locked_at ? formatDate(period.locked_at.slice(0, 10)) : ''}. Nothing in
              this period can change.
            </p>
          ) : isAdmin ? (
            <div className="flex flex-wrap items-start gap-3">
              <ActionButton
                action={lockPayPeriod}
                fields={{ id: period.id }}
                label="Lock period"
                variant="primary"
                confirm={`Lock ${formatDate(period.starts_on)} – ${formatDate(period.ends_on)}? Nothing in it can be changed afterwards, by anyone. This can't be undone.`}
              />
              <ActionButton
                action={deletePayPeriod}
                fields={{ id: period.id }}
                label="Delete period"
                confirm="Delete this pay period? Timesheet entries are not affected."
              />
              <p className="text-sm text-slate-500">
                {!ended
                  ? 'Can be locked after the last day.'
                  : pendingInPeriod > 0
                    ? `${pendingInPeriod} ${pendingInPeriod === 1 ? 'entry needs' : 'entries need'} approval before locking.`
                    : 'Every entry is approved: ready to lock.'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              An admin locks the period once everything is approved.
            </p>
          )}

          {isAdmin ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">New pay period</summary>
              <div className="mt-3">
                <NewPeriodForm suggestedStart={addDaysIso(periods[0]!.ends_on, 1)} />
              </div>
            </details>
          ) : null}
        </div>
      </Card>

      <Form action="/timesheets" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="period" value={period.id} />
        <Select label="Site" name="site" defaultValue={f.site ?? ''}>
          <option value="">All sites</option>
          {siteOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select label="Officer" name="officer" defaultValue={f.officer ?? ''}>
          <option value="">All officers</option>
          {officerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 py-2 text-sm">
          <input type="checkbox" name="flagged" value="1" defaultChecked={Boolean(f.flagged)} />
          Flagged only
        </label>
        <label className="flex items-center gap-2 py-2 text-sm">
          <input type="checkbox" name="pending" value="1" defaultChecked={Boolean(f.pending)} />
          Awaiting approval only
        </label>
        <Button type="submit">Apply</Button>
        <Link
          href={`/timesheets?${query({})}`}
          className="py-2 text-sm text-slate-500 hover:underline"
        >
          Reset
        </Link>
      </Form>

      <Card title="Totals per officer">
        {totalRows.length === 0 ? (
          <EmptyState>No timesheet entries match.</EmptyState>
        ) : (
          <Table
            head={[
              'Officer',
              'Employee no.',
              'Shifts',
              'Worked',
              'Approved',
              'Hours (decimal)',
              'Pending',
            ]}
          >
            {totalRows.map((t) => (
              <tr key={`${t.name}-${t.number}`}>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2">{t.number ?? '—'}</td>
                <td className="px-3 py-2">{t.shifts}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinutes(t.minutes)}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinutes(t.approved)}</td>
                <td className="px-3 py-2 tabular-nums">{decimalHours(t.minutes).toFixed(2)}</td>
                <td className="px-3 py-2">
                  {t.pending > 0 ? <Badge tone="warn">{t.pending}</Badge> : '0'}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {gridRows.length > 0 ? <TimesheetGrid rows={gridRows} locked={locked} /> : null}
      <p className="text-xs text-slate-500">
        Times are in {timeZone}. A shift belongs to the day it starts, so a night shift appears
        once, on its first day, with all its hours; &ldquo;+1&rdquo; marks a time on the next day.
      </p>
    </>
  );
}

function uniqueBy(entries: Entry[], id: (e: Entry) => string, label: (e: Entry) => string) {
  const map = new Map<string, string>();
  for (const e of entries) map.set(id(e), label(e));
  return [...map]
    .map(([key, value]) => ({ id: key, label: value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** "06:02", or "06:02 +1" when it falls on a later day than the work date. */
function clock(iso: string | null, workDate: string, timeZone: string): string {
  const z = zoned(iso, timeZone);
  if (!z) return '—';
  return z.date === workDate ? z.time : `${z.time} +${daysAfter(workDate, z.date)}`;
}

function daysAfter(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function toGridRow(e: Entry, timeZone: string, userId: string, locked: boolean): GridRow {
  const own = e.officer_id === userId;
  const missingOut = Boolean(e.clock_in_at) && !e.clock_out_at;
  const blocked = locked
    ? 'The pay period is locked'
    : e.status === 'approved'
      ? null
      : own
        ? 'You can’t approve your own timesheet'
        : missingOut
          ? 'No clock-out: correct it before approving'
          : null;

  // Correction form defaults: the current times, else the scheduled ones.
  const inZ = zoned(e.clock_in_at ?? e.shifts?.starts_at ?? null, timeZone);
  const outZ = zoned(e.clock_out_at ?? e.shifts?.ends_at ?? null, timeZone);

  return {
    id: e.id,
    date: formatDayShort(e.work_date),
    officer: e.officer?.full_name ?? 'Officer',
    site: e.sites?.name ?? 'Site',
    scheduled: e.shifts
      ? `${clock(e.shifts.starts_at, e.work_date, timeZone)}–${clock(e.shifts.ends_at, e.work_date, timeZone)}`
      : '—',
    clockIn: clock(e.clock_in_at, e.work_date, timeZone),
    clockOut: clock(e.clock_out_at, e.work_date, timeZone),
    originalIn:
      e.corrected_clock_in_at && e.corrected_clock_in_at !== e.original_clock_in_at
        ? clock(e.original_clock_in_at, e.work_date, timeZone)
        : null,
    originalOut:
      e.corrected_clock_out_at && e.corrected_clock_out_at !== e.original_clock_out_at
        ? clock(e.original_clock_out_at, e.work_date, timeZone)
        : null,
    worked: formatMinutes(e.worked_minutes),
    attention: attention(e),
    approved: e.status === 'approved',
    approvedBy: e.status === 'approved' ? (e.approver?.full_name ?? null) : null,
    approvable: !locked && e.status === 'pending' && !own && !missingOut,
    blocked,
    correctable: !locked && !own,
    defaults: {
      in_date: inZ?.date ?? e.work_date,
      in_time: inZ?.time ?? '08:00',
      out_date: outZ?.date ?? e.work_date,
      out_time: outZ?.time ?? '16:00',
    },
    corrections: e.timesheet_corrections.map((c) => {
      const when = zoned(c.corrected_at, timeZone)!;
      return {
        id: c.id,
        when: `${formatDate(when.date)} ${when.time}`,
        who: c.profiles?.full_name ?? 'Staff',
        change: `${clock(c.previous_clock_in_at, e.work_date, timeZone)}–${clock(
          c.previous_clock_out_at,
          e.work_date,
          timeZone,
        )} → ${clock(c.new_clock_in_at, e.work_date, timeZone)}–${clock(c.new_clock_out_at, e.work_date, timeZone)}`,
        reason: c.reason,
      };
    }),
  };
}
