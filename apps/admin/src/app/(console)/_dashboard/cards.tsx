import { addDaysIso, describeExpiry, expiryStatus, formatDate } from '@deltaguard/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ArrowRightIcon } from '@/components/icons';
import { Avatar } from '@/components/ui';

import { AttendanceBars, IncidentsBySiteBars } from './charts';
import {
  type AttendanceDay,
  type DashboardSummary,
  type ExpiringLicence,
  type SiteIncidents,
  TREND_DAYS,
} from './data';
import { ATTENDANCE_SERIES } from './series';

/** A count that opens the filtered list behind it. */
function CountRow({
  href,
  label,
  hint,
  value,
  tone = 'neutral',
}: {
  href: string;
  label: string;
  hint: string;
  value: number;
  tone?: 'neutral' | 'bad' | 'warn';
}) {
  const valueColour =
    value === 0
      ? 'text-muted'
      : tone === 'bad'
        ? 'text-red-700 dark:text-red-400'
        : tone === 'warn'
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-fg';
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-surface-2"
      >
        <span className={`w-12 text-3xl font-semibold tabular-nums ${valueColour}`}>{value}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </Link>
    </li>
  );
}

function CardTitle({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {aside}
    </div>
  );
}

export function NeedsActionCard({ summary }: { summary: DashboardSummary }) {
  const timesheetsHref = summary.timesheets_pending_period_id
    ? `/timesheets?period=${summary.timesheets_pending_period_id}&pending=1`
    : '/timesheets?pending=1';
  const total = summary.flagged + summary.incidents_awaiting_review + summary.timesheets_pending;
  return (
    <section className="flex flex-col panel p-5 sm:p-6">
      <CardTitle
        title="Needs action"
        aside={
          total === 0 ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              All clear
            </span>
          ) : null
        }
      />
      <ul className="-mx-3 flex flex-col">
        <CountRow
          href="/schedule/today?show=flagged"
          label="Flagged clock-ins"
          hint="Today: out of range, fake GPS, wrong phone…"
          value={summary.flagged}
          tone="bad"
        />
        <CountRow
          href="/incidents"
          label="Incidents awaiting review"
          hint="Submitted or under review"
          value={summary.incidents_awaiting_review}
          tone="warn"
        />
        <CountRow
          href={timesheetsHref}
          label="Timesheets awaiting approval"
          hint="Pending entries in open pay periods"
          value={summary.timesheets_pending}
          tone="warn"
        />
      </ul>
    </section>
  );
}

export function LicencesCard({
  summary,
  upcoming,
  today,
}: {
  summary: DashboardSummary;
  upcoming: ExpiringLicence[];
  today: string;
}) {
  return (
    <section className="flex flex-col panel p-5 sm:p-6">
      <CardTitle title="Licences" />
      <ul className="-mx-3 flex flex-col">
        <CountRow
          href="/officers?licence=60"
          label="Expiring within 60 days"
          hint="Active officers"
          value={summary.licences_expiring_60}
          tone="warn"
        />
        <CountRow
          href="/officers?licence=expired"
          label="Already expired"
          hint="Active officers"
          value={summary.licences_expired}
          tone="bad"
        />
      </ul>
      {upcoming.length > 0 ? (
        <>
          <h3 className="mt-3 mb-1 text-xs font-medium text-muted">Next to expire</h3>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {upcoming.map((q) => {
              const status = expiryStatus(q.expires_on, today);
              return (
                <li key={q.id}>
                  <Link
                    href={`/officers/${q.officer.id}?tab=qualifications`}
                    className="flex items-center gap-2.5 py-2 hover:underline"
                  >
                    <Avatar name={q.officer.full_name ?? '?'} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {q.officer.full_name ?? 'Unnamed officer'}
                      </span>
                      <span className="block truncate text-xs text-muted">{q.type}</span>
                    </span>
                    <span
                      className={`shrink-0 text-xs ${status.kind === 'expiring' ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted'}`}
                      title={formatDate(q.expires_on)}
                    >
                      {describeExpiry(status)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function AttendanceCard({ days }: { days: AttendanceDay[] }) {
  const totals = days.reduce(
    (t, d) => ({
      onTime: t.onTime + d.on_time,
      late: t.late + d.late,
      missed: t.missed + d.missed,
    }),
    { onTime: 0, late: 0, missed: 0 },
  );
  const attended = totals.onTime + totals.late;
  const due = attended + totals.missed;
  const pct = (n: number, of: number) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);

  return (
    <section className="flex flex-col gap-4 panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Attendance</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {ATTENDANCE_SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: s.color }}
                  aria-hidden="true"
                />
                {s.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-start gap-6">
          <Link href="/timesheets" className="group text-right">
            <span className="block text-3xl font-semibold tabular-nums group-hover:underline">
              {pct(attended, due)}
            </span>
            <span className="block text-xs text-muted">attendance rate</span>
          </Link>
          <Link href="/timesheets" className="group text-right">
            <span className="block text-3xl font-semibold tabular-nums group-hover:underline">
              {pct(totals.onTime, attended)}
            </span>
            <span className="block text-xs text-muted">on time</span>
          </Link>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
            Last {TREND_DAYS} days
          </span>
        </div>
      </div>

      {due === 0 ? (
        <p className="flex h-60 items-center justify-center rounded-2xl bg-surface-2 text-sm text-muted">
          No clock-ins in the last {TREND_DAYS} days
        </p>
      ) : (
        <div aria-hidden="true">
          <AttendanceBars days={days} />
        </div>
      )}
      <p className="text-xs text-muted">
        Attendance rate: shifts clocked in ÷ shifts that should have been (clocked in + missed). On
        time: clocked in without the late flag.
      </p>

      <table className="sr-only">
        <caption>Clock-ins per day for the last {TREND_DAYS} days</caption>
        <thead>
          <tr>
            <th>Day</th>
            {ATTENDANCE_SERIES.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th>{formatDate(d.day)}</th>
              <td>{d.on_time}</td>
              <td>{d.late}</td>
              <td>{d.missed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function IncidentsBySiteCard({ sites, today }: { sites: SiteIncidents[]; today: string }) {
  const from = addDaysIso(today, -(TREND_DAYS - 1));
  const listHref = (site?: string) =>
    `/incidents?${new URLSearchParams({ status: 'all', ...(site ? { site } : {}), from, to: today })}`;
  const total = sites.reduce((n, s) => n + s.incidents, 0);
  const shown = sites.slice(0, 8).map((s) => ({ ...s, href: listHref(s.site_id) }));

  return (
    <section className="flex flex-col gap-4 panel p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Incidents by site</h2>
          <p className="text-sm text-muted">Last {TREND_DAYS} days, any status</p>
        </div>
        <Link href={listHref()} className="group text-right">
          <span className="block text-3xl font-semibold tabular-nums group-hover:underline">
            {total}
          </span>
          <span className="block text-xs text-muted">incidents</span>
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="flex min-h-40 flex-1 items-center justify-center rounded-2xl bg-surface-2 text-sm text-muted">
          No incidents in the last {TREND_DAYS} days
        </p>
      ) : (
        <>
          <div aria-hidden="true">
            <IncidentsBySiteBars sites={shown} />
          </div>
          {sites.length > shown.length ? (
            <Link href={listHref()} className="text-sm font-medium text-accent-ink hover:underline">
              {sites.length - shown.length} more sites →
            </Link>
          ) : null}
          <ul className="sr-only">
            {shown.map((s) => (
              <li key={s.site_id}>
                <Link href={s.href}>
                  {s.site_name}: {s.incidents} incidents, {s.high_or_critical} high or critical
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
