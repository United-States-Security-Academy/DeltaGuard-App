import {
  type AttendanceType,
  DEFAULT_TIME_ZONE,
  parseSiteContacts,
  type ShiftStatus,
  type SiteContact,
} from '@deltaguard/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from './supabase';

// Shifts for the signed-in user. RLS only lets officers read their own shifts
// and the sites they are assigned to; the officer_id filter also keeps
// supervisors (who can read every shift) to their own on this screen.

export const shiftKeys = {
  all: ['shifts'] as const,
  mine: (userId: string) => ['shifts', 'mine', userId] as const,
  settings: ['company-settings'] as const,
};

export type ShiftSite = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  emergencyInstructions: string | null;
  contacts: SiteContact[];
};

export type ShiftAttendance = {
  type: AttendanceType;
  recordedAt: string;
  deviceTime: string | null;
  flags: string[];
  accepted: boolean;
  distanceM: number | null;
};

export type MyShift = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  notes: string | null;
  acknowledgedAt: string | null;
  /** null if the officer is no longer assigned to the site (RLS hides it). */
  site: ShiftSite | null;
  attendance: ShiftAttendance[];
};

/** Ended shifts stay in the list this long (to see the result, or clock out late). */
const RECENT_MS = 24 * 60 * 60 * 1000;

export function useMyShifts(userId: string) {
  return useQuery({
    queryKey: shiftKeys.mine(userId),
    queryFn: async (): Promise<MyShift[]> => {
      const since = new Date(Date.now() - RECENT_MS).toISOString();
      const { data, error } = await supabase
        .from('shifts')
        .select(
          `id, starts_at, ends_at, status, notes, acknowledged_at,
           sites(id, name, address, latitude, longitude, clock_in_radius_m, emergency_instructions, site_contacts),
           attendance_events(type, recorded_at, device_time, flags, accepted, distance_from_site_m)`,
        )
        .eq('officer_id', userId)
        // Still-open shifts are kept however old, so a forgotten clock-out
        // can still be done.
        .or(`ends_at.gte.${since},status.eq.in_progress`)
        .order('starts_at', { ascending: true })
        .limit(60);
      if (error) throw error;
      return data.map((s) => ({
        id: s.id,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        status: s.status,
        notes: s.notes,
        acknowledgedAt: s.acknowledged_at,
        site: s.sites
          ? {
              id: s.sites.id,
              name: s.sites.name,
              address: s.sites.address,
              latitude: s.sites.latitude,
              longitude: s.sites.longitude,
              radiusM: s.sites.clock_in_radius_m,
              emergencyInstructions: s.sites.emergency_instructions,
              contacts: parseSiteContacts(s.sites.site_contacts),
            }
          : null,
        attendance: s.attendance_events.map((e) => ({
          type: e.type,
          recordedAt: e.recorded_at,
          deviceTime: e.device_time,
          flags: e.flags,
          accepted: e.accepted,
          distanceM: e.distance_from_site_m,
        })),
      }));
    },
    // Times matter here: check again every minute while the screen is open.
    refetchInterval: 60_000,
  });
}

export type CompanySettings = {
  timeZone: string;
  earlyClockInMinutes: number;
  lateGraceMinutes: number;
};

const DEFAULT_SETTINGS: CompanySettings = {
  timeZone: DEFAULT_TIME_ZONE,
  earlyClockInMinutes: 60,
  lateGraceMinutes: 10,
};

/** Company settings, or the defaults until (or if) they load. */
export function useCompanySettings(): CompanySettings {
  const query = useQuery({
    queryKey: shiftKeys.settings,
    queryFn: async (): Promise<CompanySettings> => {
      // select('*'): time_zone may not exist yet on a database without the
      // Phase 4 migration; fall back to the default zone then.
      const { data, error } = await supabase.from('settings').select('*').maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULT_SETTINGS;
      return {
        timeZone: data.time_zone ?? DEFAULT_TIME_ZONE,
        earlyClockInMinutes: data.early_clock_in_minutes,
        lateGraceMinutes: data.late_grace_minutes,
      };
    },
    staleTime: 10 * 60_000,
  });
  return query.data ?? DEFAULT_SETTINGS;
}

export function useAcknowledgeShift(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (shiftId: string) => {
      const { error } = await supabase.rpc('acknowledge_shift', { p_shift_id: shiftId });
      if (error) throw new Error(error.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: shiftKeys.mine(userId) }),
  });
}

/** The accepted clock-in / clock-out of a shift, if any. */
export function acceptedEvent(shift: MyShift, type: AttendanceType) {
  return shift.attendance.find((e) => e.accepted && e.type === type) ?? null;
}

export const STATUS_LABELS: Record<ShiftStatus, string> = {
  scheduled: 'Not acknowledged',
  acknowledged: 'Acknowledged',
  in_progress: 'On duty',
  completed: 'Completed',
  missed: 'Missed',
  cancelled: 'Cancelled',
};
