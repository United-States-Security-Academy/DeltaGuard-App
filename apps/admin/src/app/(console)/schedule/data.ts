import 'server-only';

import {
  DEFAULT_TIME_ZONE,
  formatDate,
  formatTimeRange,
  isValidTimeZone,
  type ShiftTimes,
  toZoned,
} from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The company time zone from settings (falls back to Africa/Lagos). */
export async function getTimeZone(supabase: Supabase): Promise<string> {
  const { data } = await supabase.from('settings').select('time_zone').maybeSingle();
  const zone = data?.time_zone;
  return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

export type OverlapWarning = {
  /** The occurrence (from the form) that clashes, "YYYY-MM-DD". */
  date: string;
  shiftId: string;
  siteName: string;
  /** Human-readable time of the existing shift. */
  when: string;
};

/**
 * Existing, non-cancelled shifts of this officer that overlap any of the
 * given occurrences. The database refuses these anyway (shifts_no_overlap);
 * this lets the console explain the clash before saving.
 */
export async function findOverlaps(
  supabase: Supabase,
  officerId: string,
  occurrences: ShiftTimes[],
  timeZone: string,
  excludeShiftId?: string,
): Promise<OverlapWarning[]> {
  if (occurrences.length === 0) return [];
  const from = occurrences.reduce(
    (min, o) => (o.starts_at < min ? o.starts_at : min),
    occurrences[0]!.starts_at,
  );
  const to = occurrences.reduce(
    (max, o) => (o.ends_at > max ? o.ends_at : max),
    occurrences[0]!.ends_at,
  );

  let query = supabase
    .from('shifts')
    .select('id, starts_at, ends_at, sites(name)')
    .eq('officer_id', officerId)
    .neq('status', 'cancelled')
    .lt('starts_at', to)
    .gt('ends_at', from);
  if (excludeShiftId) query = query.neq('id', excludeShiftId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not check for overlapping shifts: ${error.message}`);

  const warnings: OverlapWarning[] = [];
  for (const o of occurrences) {
    const start = Date.parse(o.starts_at);
    const end = Date.parse(o.ends_at);
    for (const s of data) {
      if (Date.parse(s.starts_at) < end && Date.parse(s.ends_at) > start) {
        const day = toZoned(s.starts_at, timeZone).date;
        warnings.push({
          date: o.date,
          shiftId: s.id,
          siteName: s.sites?.name ?? 'another site',
          when: `${formatDate(day)}, ${formatTimeRange(s.starts_at, s.ends_at, timeZone)}`,
        });
      }
    }
  }
  return warnings;
}

type QualificationRow = { user_id: string; type: string; expires_on: string | null };

/**
 * One entry per officer and licence type, keeping only the latest expiry, so a
 * renewed licence hides the old expired one. null (no expiry) beats any date.
 */
function latestExpiries(rows: QualificationRow[]) {
  const latest = new Map<string, { userId: string; type: string; expiresOn: string | null }>();
  for (const q of rows) {
    const key = `${q.user_id}|${q.type.trim().toLowerCase()}`;
    const current = latest.get(key);
    if (current && current.expiresOn === null) continue;
    if (!current || q.expires_on === null || (current.expiresOn ?? '') < q.expires_on) {
      latest.set(key, { userId: q.user_id, type: q.type, expiresOn: q.expires_on });
    }
  }
  return [...latest.values()];
}

export type LicenceWarning = { type: string; expiresOn: string; message: string };

/**
 * Licences that will have expired by the last of these shift dates. A licence
 * is valid through its expiry date.
 */
export async function findLicenceWarnings(
  supabase: Supabase,
  officerId: string,
  shiftDates: string[],
): Promise<LicenceWarning[]> {
  if (shiftDates.length === 0) return [];
  const first = shiftDates.reduce((a, b) => (b < a ? b : a));
  const last = shiftDates.reduce((a, b) => (b > a ? b : a));

  const { data, error } = await supabase
    .from('qualifications')
    .select('user_id, type, expires_on')
    .eq('user_id', officerId);
  if (error) throw new Error(`Could not check licences: ${error.message}`);

  return latestExpiries(data).flatMap(({ type, expiresOn }) =>
    expiresOn !== null && expiresOn < last
      ? [
          {
            type,
            expiresOn,
            message:
              expiresOn < first
                ? `${type} expired on ${formatDate(expiresOn)}.`
                : `${type} expires on ${formatDate(expiresOn)}, before some of these shifts.`,
          },
        ]
      : [],
  );
}

export type LicenceExpiry = { type: string; expiresOn: string };

/** Latest expiry per licence type, per officer (types with no expiry date are left out). */
export async function licenceExpiries(
  supabase: Supabase,
  officerIds: string[],
): Promise<Map<string, LicenceExpiry[]>> {
  const result = new Map<string, LicenceExpiry[]>();
  if (officerIds.length === 0) return result;
  const { data, error } = await supabase
    .from('qualifications')
    .select('user_id, type, expires_on')
    .in('user_id', officerIds);
  if (error) throw new Error(`Could not load licences: ${error.message}`);

  for (const q of latestExpiries(data)) {
    if (q.expiresOn === null) continue;
    result.set(q.userId, [
      ...(result.get(q.userId) ?? []),
      { type: q.type, expiresOn: q.expiresOn },
    ]);
  }
  return result;
}

/** Licence types that are no longer valid on `date` ("YYYY-MM-DD"). */
export function expiredOn(expiries: LicenceExpiry[] | undefined, date: string): string[] {
  return (expiries ?? []).filter((l) => l.expiresOn < date).map((l) => l.type);
}

/** Choices for the shift form: active sites and officers, and who is assigned where. */
export async function loadFormOptions(supabase: Supabase) {
  const [sites, officers, assignments] = await Promise.all([
    supabase.from('sites').select('id, name, clients(name)').eq('active', true).order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'officer')
      .eq('employment_status', 'active')
      .order('full_name'),
    supabase.from('site_assignments').select('site_id, officer_id'),
  ]);
  for (const { error } of [sites, officers, assignments]) {
    if (error) throw new Error(`Could not load sites and officers: ${error.message}`);
  }
  if (!sites.data || !officers.data || !assignments.data)
    throw new Error('Could not load sites and officers');

  const bySite: Record<string, string[]> = {};
  for (const a of assignments.data) (bySite[a.site_id] ??= []).push(a.officer_id);

  return {
    sites: sites.data.map((s) => ({ id: s.id, name: s.name, clientName: s.clients?.name ?? null })),
    officers: officers.data.map((o) => ({ id: o.id, name: o.full_name ?? 'Unnamed officer' })),
    assignments: bySite,
  };
}
