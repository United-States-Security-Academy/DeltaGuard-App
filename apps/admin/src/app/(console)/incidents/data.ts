import 'server-only';

import { formatDate, toZoned } from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** One incident with everything the review screen and the PDF show. RLS applies. */
export async function loadIncident(supabase: Supabase, id: string) {
  const [incident, history] = await Promise.all([
    supabase
      .from('incidents')
      .select(
        `*,
         sites(name, address, clients(name)),
         officer:profiles!incidents_officer_id_fkey(full_name, phone),
         reviewer:profiles!incidents_reviewer_id_fkey(full_name),
         shifts(starts_at, ends_at),
         incident_photos(id, storage_path, created_at)`,
      )
      .eq('id', id)
      .order('created_at', { referencedTable: 'incident_photos' })
      .maybeSingle(),
    supabase
      .from('incident_status_history')
      .select('id, from_status, to_status, notes, changed_at, profiles(full_name)')
      .eq('incident_id', id)
      .order('changed_at'),
  ]);
  if (incident.error) throw new Error(incident.error.message);
  if (history.error) throw new Error(history.error.message);
  return incident.data ? { ...incident.data, history: history.data } : null;
}

export type LoadedIncident = NonNullable<Awaited<ReturnType<typeof loadIncident>>>;

export function formatWhen(iso: string, timeZone: string): string {
  const zoned = toZoned(iso, timeZone);
  return `${formatDate(zoned.date)} ${zoned.time}`;
}
