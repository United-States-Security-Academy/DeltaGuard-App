import { INCIDENT_PHOTOS_BUCKET } from '@deltaguard/shared';
import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';

// Incident reports already on the server, for the signed-in officer. RLS
// only returns their own; the officer_id filter also keeps supervisors to
// their own reports on this screen.

export const incidentKeys = {
  all: ['incidents'] as const,
  mine: (userId: string) => ['incidents', 'mine', userId] as const,
  one: (id: string) => ['incidents', 'one', id] as const,
};

export function useMyIncidents(userId: string) {
  return useQuery({
    queryKey: incidentKeys.mine(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('incidents')
        .select(
          'id, occurred_at, category, severity, status, submitted_at, review_notes, sites(name), incident_photos(count)',
        )
        .eq('officer_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    // Picks up a reviewer's decision while the screen is open.
    refetchInterval: 60_000,
  });
}

export function useIncident(id: string) {
  return useQuery({
    queryKey: incidentKeys.one(id),
    queryFn: async () => {
      const [incident, history] = await Promise.all([
        supabase
          .from('incidents')
          .select('*, sites(name), incident_photos(id, storage_path)')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('incident_status_history')
          .select('id, from_status, to_status, notes, changed_at')
          .eq('incident_id', id)
          .order('changed_at'),
      ]);
      if (incident.error) throw incident.error;
      if (history.error) throw history.error;
      if (!incident.data) return null;

      const paths = incident.data.incident_photos.map((p) => p.storage_path);
      const signed = paths.length
        ? await supabase.storage.from(INCIDENT_PHOTOS_BUCKET).createSignedUrls(paths, 15 * 60)
        : { data: [] };
      const photoUrls = (signed.data ?? []).flatMap((s) => (s.signedUrl ? [s.signedUrl] : []));
      return { ...incident.data, history: history.data, photoUrls };
    },
    staleTime: 5 * 60_000,
  });
}

export type ServerIncident = NonNullable<ReturnType<typeof useIncident>['data']>;
