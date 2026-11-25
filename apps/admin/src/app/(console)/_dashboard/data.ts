import 'server-only';

import { addDaysIso, type IncidentSeverity } from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Length of the "last N days" charts. */
export const TREND_DAYS = 30;

// Aggregates come from SQL functions (migration phase10_dashboard). They run with
// the caller's permissions, so RLS decides what each staff member's numbers cover.

/** Today's counts and the exceptions waiting for someone (one row). */
export async function loadSummary(supabase: Supabase) {
  const { data, error } = await supabase.rpc('dashboard_summary').single();
  if (error) throw new Error(`Could not load the dashboard: ${error.message}`);
  return data;
}
export type DashboardSummary = Awaited<ReturnType<typeof loadSummary>>;

/** Clock-in outcomes per day, oldest first. */
export async function loadAttendance(supabase: Supabase) {
  const { data, error } = await supabase.rpc('dashboard_attendance', { p_days: TREND_DAYS });
  if (error) throw new Error(`Could not load attendance: ${error.message}`);
  return data;
}
export type AttendanceDay = Awaited<ReturnType<typeof loadAttendance>>[number];

/** Incidents per site, most first. */
export async function loadIncidentsBySite(supabase: Supabase) {
  const { data, error } = await supabase.rpc('dashboard_incidents_by_site', {
    p_days: TREND_DAYS,
  });
  if (error) throw new Error(`Could not load incidents by site: ${error.message}`);
  return data;
}
export type SiteIncidents = Awaited<ReturnType<typeof loadIncidentsBySite>>[number];

/**
 * The next licences to expire (within 60 days) for active officers, soonest first.
 * A short list, not an aggregate: the counts come from dashboard_summary.
 */
export async function loadExpiringLicences(supabase: Supabase, today: string, limit = 5) {
  const { data, error } = await supabase
    .from('qualifications')
    .select('id, type, expires_on, officer:profiles!inner(id, full_name, role, employment_status)')
    .gte('expires_on', today)
    .lte('expires_on', addDaysIso(today, 60))
    .eq('officer.role', 'officer')
    .eq('officer.employment_status', 'active')
    .order('expires_on')
    .limit(limit);
  if (error) throw new Error(`Could not load licences: ${error.message}`);
  return data;
}
export type ExpiringLicence = Awaited<ReturnType<typeof loadExpiringLicences>>[number];

const SEVERITY_RANK: Record<IncidentSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Incidents waiting for a reviewer: most severe first, then oldest. RLS applies. */
export async function loadIncidentsToReview(supabase: Supabase) {
  const { data, error } = await supabase
    .from('incidents')
    .select(
      `id, category, severity, status, police_called, submitted_at, description,
       sites(name),
       officer:profiles!incidents_officer_id_fkey(full_name),
       incident_photos(count)`,
    )
    .in('status', ['submitted', 'under_review'])
    .order('submitted_at')
    .limit(50);
  if (error) throw new Error(`Could not load incidents: ${error.message}`);

  return [...data].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.submitted_at.localeCompare(b.submitted_at),
  );
}

export type IncidentToReview = Awaited<ReturnType<typeof loadIncidentsToReview>>[number];
