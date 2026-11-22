import {
  addDaysIso,
  firstParam,
  formatDate,
  formatDayShort,
  formatTimeRange,
  fromZoned,
  isoDateSchema,
  type ShiftStatus,
  startOfWeekIso,
  todayInZone,
  toZoned,
} from '@deltaguard/shared';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { z } from 'zod';

import { shiftStatusLabel } from '@/components/status';
import { Badge, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { expiredOn, getTimeZone, licenceExpiries } from './data';
import { ScheduleTabs } from './tabs';

const filtersSchema = z.object({
  view: z.preprocess(firstParam, z.enum(['site', 'officer'])).catch('site'),
  week: z.preprocess(firstParam, isoDateSchema.optional()).catch(undefined),
  cancelled: z.preprocess(firstParam, z.literal('1').optional()).catch(undefined),
});
type Filters = z.infer<typeof filtersSchema>;

export default function SchedulePage({ searchParams }: PageProps<'/schedule'>) {
  return (
    <div className="flex flex-col gap-6">
      <ScheduleTabs current="week" />
      <Suspense fallback={<p className="text-slate-500">Loading schedule…</p>}>
        <WeekContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type GridShift = {
  id: string;
  site_id: string;
  officer_id: string;
  starts_at: string;
  ends_at: string;
  status: ShiftStatus;
  siteName: string;
  officerName: string;
  date: string;
  expiredLicences: string[];
};

type Row = { id: string; name: string; sub: string | null; href: string; inactive?: boolean };

async function WeekContent({
  searchParams,
}: {
  searchParams: PageProps<'/schedule'>['searchParams'];
}) {
  await requireStaff();
  await connection(); // "today" depends on the current time
  const filters = filtersSchema.parse(await searchParams);
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  const today = todayInZone(timeZone);
  const monday = startOfWeekIso(filters.week ?? today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const weekStart = fromZoned(monday, '00:00', timeZone).toISOString();
  const weekEnd = fromZoned(addDaysIso(monday, 7), '00:00', timeZone).toISOString();

  // A shift belongs to the day it starts (an overnight shift shows on its first day).
  let shiftsQuery = supabase
    .from('shifts')
    .select(
      'id, site_id, officer_id, starts_at, ends_at, status, sites(name), officer:profiles!shifts_officer_id_fkey(full_name)',
    )
    .gte('starts_at', weekStart)
    .lt('starts_at', weekEnd)
    .order('starts_at');
  if (!filters.cancelled) shiftsQuery = shiftsQuery.neq('status', 'cancelled');

  const [shifts, sites, officers] = await Promise.all([
    shiftsQuery,
    supabase.from('sites').select('id, name, active, clients(name)').order('name'),
    supabase
      .from('profiles')
      .select('id, full_name, employment_status')
      .eq('role', 'officer')
      .order('full_name'),
  ]);
  if (shifts.error || sites.error || officers.error) {
    const message = (shifts.error ?? sites.error ?? officers.error)?.message;
    return <ErrorText>Could not load the schedule: {message}</ErrorText>;
  }

  const officerIds = [
    ...new Set(shifts.data.map((s) => s.officer_id).concat(officers.data.map((o) => o.id))),
  ];
  const expiries = await licenceExpiries(supabase, officerIds);

  const gridShifts: GridShift[] = shifts.data.map((s) => {
    const date = toZoned(s.starts_at, timeZone).date;
    return {
      id: s.id,
      site_id: s.site_id,
      officer_id: s.officer_id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      status: s.status,
      siteName: s.sites?.name ?? 'Unknown site',
      officerName: s.officer?.full_name ?? 'Unnamed officer',
      date,
      expiredLicences: expiredOn(expiries.get(s.officer_id), date),
    };
  });

  // Rows: everything active, plus anything inactive that still has shifts this week.
  const withShifts = new Set(
    gridShifts.map((s) => (filters.view === 'site' ? s.site_id : s.officer_id)),
  );
  const referenceDay = today > monday ? today : monday;
  const rows: Row[] =
    filters.view === 'site'
      ? sites.data
          .filter((s) => s.active || withShifts.has(s.id))
          .map((s) => ({
            id: s.id,
            name: s.name,
            sub: s.clients?.name ?? null,
            href: `/sites/${s.id}`,
            inactive: !s.active,
          }))
      : officers.data
          .filter((o) => o.employment_status === 'active' || withShifts.has(o.id))
          .map((o) => {
            const hours = gridShifts
              .filter((s) => s.officer_id === o.id && s.status !== 'cancelled')
              .reduce(
                (h, s) => h + (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 3_600_000,
                0,
              );
            return {
              id: o.id,
              name: o.full_name ?? 'Unnamed officer',
              sub: `${Math.round(hours * 10) / 10} h this week`,
              href: `/officers/${o.id}`,
              inactive: o.employment_status !== 'active',
            };
          });

  const link = (changes: Partial<Filters>) => {
    const next = { ...filters, week: monday, ...changes };
    const params = new URLSearchParams({ view: next.view, week: next.week ?? monday });
    if (next.cancelled) params.set('cancelled', '1');
    return `/schedule?${params}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <NavLink href={link({ week: addDaysIso(monday, -7) })} label="← Previous" />
          <NavLink href={link({ week: startOfWeekIso(today) })} label="This week" />
          <NavLink href={link({ week: addDaysIso(monday, 7) })} label="Next →" />
          <span className="ml-2 font-medium">
            {formatDate(monday)} – {formatDate(days[6])}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <ToggleLink
              href={link({ view: 'site' })}
              active={filters.view === 'site'}
              label="By site"
            />
            <ToggleLink
              href={link({ view: 'officer' })}
              active={filters.view === 'officer'}
              label="By officer"
            />
          </div>
          <Link
            href={link({ cancelled: filters.cancelled ? undefined : '1' })}
            className="text-slate-500 hover:underline"
          >
            {filters.cancelled ? 'Hide cancelled' : 'Show cancelled'}
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {filters.view === 'site' ? 'No active sites yet.' : 'No active officers yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="w-48 px-3 py-2 text-left font-medium">
                  {filters.view === 'site' ? 'Site' : 'Officer'}
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    className={`px-2 py-2 text-left font-medium ${d === today ? 'text-slate-900 dark:text-white' : ''}`}
                  >
                    {formatDayShort(d)}
                    {d === today ? (
                      <span className="ml-1 rounded bg-slate-900 px-1 text-[10px] text-white uppercase dark:bg-white dark:text-slate-900">
                        Today
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowShifts = gridShifts.filter((s) =>
                  filters.view === 'site' ? s.site_id === row.id : s.officer_id === row.id,
                );
                const rowExpired =
                  filters.view === 'officer' ? expiredOn(expiries.get(row.id), referenceDay) : [];
                return (
                  <tr
                    key={row.id}
                    className="border-t border-slate-200 align-top dark:border-slate-800"
                  >
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Link href={row.href} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                      {row.sub ? <div className="text-xs text-slate-500">{row.sub}</div> : null}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.inactive ? <Badge>Inactive</Badge> : null}
                        {rowExpired.length > 0 ? (
                          <span title={rowExpired.join(', ')}>
                            <Badge tone="bad">Licence expired</Badge>
                          </span>
                        ) : null}
                      </div>
                    </th>
                    {days.map((d) => (
                      <td
                        key={d}
                        className={`group px-1.5 py-1.5 ${d === today ? 'bg-slate-50 dark:bg-slate-900/60' : ''}`}
                      >
                        <div className="flex min-h-14 flex-col gap-1">
                          {rowShifts
                            .filter((s) => s.date === d)
                            .map((s) => (
                              <ShiftChip
                                key={s.id}
                                shift={s}
                                view={filters.view}
                                timeZone={timeZone}
                              />
                            ))}
                          {d >= today && !row.inactive ? (
                            <Link
                              href={`/schedule/new?${new URLSearchParams({
                                [filters.view]: row.id,
                                date: d,
                                view: filters.view,
                              })}`}
                              aria-label={`Add shift for ${row.name} on ${formatDayShort(d)}`}
                              className="rounded border border-dashed border-slate-300 py-0.5 text-center text-xs text-slate-400 opacity-0 group-hover:opacity-100 hover:border-slate-500 hover:text-slate-700 focus:opacity-100 dark:border-slate-700 dark:hover:text-slate-200"
                            >
                              +
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Legend />
      <p className="text-xs text-slate-500">Times are in {timeZone.replace('_', ' ')} time.</p>
    </div>
  );
}

const CHIP_STYLES: Record<ShiftStatus, string> = {
  scheduled: 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900',
  acknowledged: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/60',
  in_progress: 'border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/60',
  completed:
    'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60',
  missed: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/60',
  cancelled: 'border-dashed border-slate-300 text-slate-400 line-through dark:border-slate-700',
};

function ShiftChip({
  shift,
  view,
  timeZone,
}: {
  shift: GridShift;
  view: 'site' | 'officer';
  timeZone: string;
}) {
  const warn = shift.expiredLicences.length > 0 && shift.status !== 'cancelled';
  return (
    <Link
      href={`/schedule/${shift.id}?view=${view}`}
      title={`${shiftStatusLabel(shift.status)}${warn ? ` · Licence expired: ${shift.expiredLicences.join(', ')}` : ''}`}
      className={`block rounded-md border px-1.5 py-1 text-xs leading-tight hover:shadow-sm ${CHIP_STYLES[shift.status]} ${warn ? 'ring-2 ring-amber-400' : ''}`}
    >
      <div className="font-medium tabular-nums">
        {warn ? <span aria-label="Licence expired">⚠ </span> : null}
        {formatTimeRange(shift.starts_at, shift.ends_at, timeZone)}
      </div>
      <div className="truncate">{view === 'site' ? shift.officerName : shift.siteName}</div>
      {shift.status !== 'scheduled' ? (
        <div className="text-[10px] tracking-wide uppercase opacity-70">
          {shiftStatusLabel(shift.status)}
        </div>
      ) : null}
    </Link>
  );
}

function Legend() {
  const items: ShiftStatus[] = [
    'scheduled',
    'acknowledged',
    'in_progress',
    'completed',
    'missed',
    'cancelled',
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
      {items.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-sm border ${CHIP_STYLES[s]}`} />
          {shiftStatusLabel(s)}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-amber-400" />
        Licence expired on that day
      </span>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      {label}
    </Link>
  );
}

function ToggleLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-3 py-1 font-medium ${
        active
          ? 'bg-white shadow-sm dark:bg-slate-700'
          : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
      }`}
    >
      {label}
    </Link>
  );
}
