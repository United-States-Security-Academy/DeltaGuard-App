import 'server-only';

import {
  addDaysIso,
  todayInZone,
  type WelfareCheckStatus,
  type WelfareReportFilters,
} from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

import { BATTERY_LOW_PERCENT, HEARTBEAT_STALE_MINUTES } from './labels';
import { loadError } from '@/lib/server-errors';

type Supabase = Awaited<ReturnType<typeof createClient>>;

// The board and reports come from SQL functions (migration phase17b). They run
// with the caller's permissions: supervisors only get their own sites.

/** One officer on duty (generated types mark every column non-null; most can be null). */
export type BoardRow = {
  shiftId: string;
  officerId: string;
  officerName: string;
  officerPhone: string | null;
  siteId: string;
  siteName: string;
  startsAt: string;
  endsAt: string;
  checksEnabled: boolean;
  policyName: string | null;
  /** officer | officer_off | site | site_off | company | none */
  policySource: string;
  open: {
    id: string;
    status: WelfareCheckStatus;
    scheduledAt: string;
    promptedAt: string | null;
    acknowledgedAt: string | null;
  } | null;
  last: {
    id: string;
    status: WelfareCheckStatus;
    scheduledAt: string;
    respondedAt: string | null;
    responseSeconds: number | null;
    flags: string[];
  } | null;
  answered: number;
  missed: number;
  heartbeat: { at: string; battery: number | null; appState: string } | null;
  pause: { reason: string; pausedAt: string; resumeAt: string | null; by: string | null } | null;
};

export async function loadWelfareBoard(supabase: Supabase): Promise<BoardRow[]> {
  const { data, error } = await supabase.rpc('welfare_board');
  if (error) throw loadError('the welfare board', error);
  return data.map((r) => ({
    shiftId: r.shift_id,
    officerId: r.officer_id,
    officerName: r.officer_name ?? 'Unnamed officer',
    officerPhone: r.officer_phone ?? null,
    siteId: r.site_id,
    siteName: r.site_name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    checksEnabled: r.checks_enabled ?? false,
    policyName: r.policy_name ?? null,
    policySource: r.policy_source,
    open: r.open_check_id
      ? {
          id: r.open_check_id,
          status: r.open_status,
          scheduledAt: r.open_scheduled_at,
          promptedAt: r.open_prompted_at ?? null,
          acknowledgedAt: r.open_acknowledged_at ?? null,
        }
      : null,
    last: r.last_check_id
      ? {
          id: r.last_check_id,
          status: r.last_status,
          scheduledAt: r.last_scheduled_at,
          respondedAt: r.last_responded_at ?? null,
          responseSeconds: r.last_response_seconds ?? null,
          flags: r.last_response_flags ?? [],
        }
      : null,
    answered: r.answered_count,
    missed: r.missed_count,
    heartbeat: r.heartbeat_at
      ? { at: r.heartbeat_at, battery: r.battery_level ?? null, appState: r.app_state }
      : null,
    pause: r.pause_id
      ? {
          reason: r.pause_reason,
          pausedAt: r.paused_at,
          resumeAt: r.pause_resume_at ?? null,
          by: r.paused_by_name ?? null,
        }
      : null,
  }));
}

/** Rows that need someone now first: escalated, then alarm/calling, then the rest by name. */
export function boardUrgency(row: BoardRow, now: number): number {
  const s = row.open?.status;
  if (s === 'escalated') return row.open?.acknowledgedAt ? 1 : 0;
  if (s === 'calling' || s === 'alarm') return 2;
  if (s === 'prompted') return 3;
  if (isHeartbeatStale(row, now) || isBatteryLow(row)) return 4;
  return 5;
}

export function isHeartbeatStale(row: BoardRow, now: number): boolean {
  if (!row.checksEnabled || row.pause) return false;
  if (!row.heartbeat) return true;
  return now - Date.parse(row.heartbeat.at) > HEARTBEAT_STALE_MINUTES * 60_000;
}

export function isBatteryLow(row: BoardRow): boolean {
  return row.heartbeat?.battery !== null && row.heartbeat?.battery !== undefined
    ? row.heartbeat.battery <= BATTERY_LOW_PERCENT
    : false;
}

/** Counts for the board header and the dashboard panel. */
export function boardCounts(rows: BoardRow[], now: number) {
  return {
    onDuty: rows.length,
    monitored: rows.filter((r) => r.checksEnabled && !r.pause).length,
    escalated: rows.filter((r) => r.open?.status === 'escalated').length,
    alarm: rows.filter((r) => r.open?.status === 'alarm' || r.open?.status === 'calling').length,
    waiting: rows.filter((r) => r.open?.status === 'prompted').length,
    paused: rows.filter((r) => r.pause).length,
    phoneIssues: rows.filter((r) => isHeartbeatStale(r, now) || isBatteryLow(r)).length,
  };
}

// Reports ----------------------------------------------------------------------

/** Report filters with every default filled in. */
export type ReportQuery = {
  from: string;
  to: string;
  group: WelfareReportFilters['group'];
  period: WelfareReportFilters['period'];
  nightStart: string;
  nightEnd: string;
  officer?: string;
  site?: string;
};

/**
 * Defaults: the last 7 days including today (company time zone); night hours
 * from the company default policy, else 22:00-06:00.
 */
export async function resolveReportQuery(
  supabase: Supabase,
  f: WelfareReportFilters,
  timeZone: string,
): Promise<ReportQuery> {
  const today = todayInZone(timeZone);
  const to = f.to ?? today;
  const from = f.from ?? addDaysIso(to, -6);
  let nightStart = f.night_start;
  let nightEnd = f.night_end;
  if (!nightStart || !nightEnd) {
    const { data } = await supabase
      .from('settings')
      .select('policy:welfare_check_policies(night_start, night_end)')
      .maybeSingle();
    nightStart ??= data?.policy?.night_start?.slice(0, 5) ?? '22:00';
    nightEnd ??= data?.policy?.night_end?.slice(0, 5) ?? '06:00';
  }
  if (nightStart === nightEnd) nightEnd = nightStart === '06:00' ? '22:00' : '06:00';
  return {
    ...(from <= to ? { from, to } : { from: to, to: from }),
    group: f.group,
    period: f.period,
    nightStart,
    nightEnd,
    officer: f.officer,
    site: f.site,
  };
}

function reportArgs(q: ReportQuery) {
  return {
    p_from: q.from,
    p_to: q.to,
    p_period: q.period,
    p_night_start: q.nightStart,
    p_night_end: q.nightEnd,
    p_officer_id: q.officer,
    p_site_id: q.site,
  };
}

export async function loadWelfareReport(supabase: Supabase, q: ReportQuery) {
  const { data, error } = await supabase.rpc('welfare_report', {
    ...reportArgs(q),
    p_group: q.group,
  });
  if (error) throw loadError('the report', error);
  return data;
}
export type WelfareReportRow = Awaited<ReturnType<typeof loadWelfareReport>>[number];

export async function loadWelfareCheckRows(supabase: Supabase, q: ReportQuery, shiftId?: string) {
  const { data, error } = await supabase.rpc('welfare_check_rows', {
    ...reportArgs(q),
    p_shift_id: shiftId,
  });
  if (error) throw loadError('welfare checks', error);
  return data;
}
export type WelfareCheckRow = Awaited<ReturnType<typeof loadWelfareCheckRows>>[number];

/** Totals over report rows (the table footer). */
export function reportTotals(rows: WelfareReportRow[]) {
  const sum = (k: 'prompted' | 'answered' | 'answered_late' | 'missed' | 'escalated') =>
    rows.reduce((n, r) => n + r[k], 0);
  const answered = sum('answered');
  const weighted = rows.reduce(
    (n, r) =>
      n + (r.avg_response_seconds === null ? 0 : Number(r.avg_response_seconds) * r.answered),
    0,
  );
  return {
    prompted: sum('prompted'),
    answered,
    answered_late: sum('answered_late'),
    missed: sum('missed'),
    escalated: sum('escalated'),
    avg_response_seconds: answered ? weighted / answered : null,
    max_response_seconds: rows.reduce<number | null>(
      (m, r) => (r.max_response_seconds === null ? m : Math.max(m ?? 0, r.max_response_seconds)),
      null,
    ),
  };
}

/** "92%" or "—". */
export function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—';
}
