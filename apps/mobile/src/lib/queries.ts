import {
  type EmergencyContact,
  emergencyContactSchema,
  LICENSES_BUCKET,
  parseSiteContacts,
  type SiteContact,
} from '@deltaguard/shared';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

// Data for the signed-in user. RLS already limits officers to their own rows
// and assigned sites; the explicit filters below also keep supervisors (who
// can read more) to their own records on these personal screens.

export const queryKeys = {
  myDetails: (userId: string) => ['my-details', userId] as const,
  myQualifications: (userId: string) => ['my-qualifications', userId] as const,
  mySites: (userId: string) => ['my-sites', userId] as const,
};

export type MyDetails = {
  phone: string | null;
  employeeNumber: string | null;
  address: string | null;
  dateHired: string | null;
  emergencyContact: EmergencyContact | null;
};

export function useMyDetails(userId: string) {
  return useQuery({
    queryKey: queryKeys.myDetails(userId),
    queryFn: async (): Promise<MyDetails> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('phone, officer_details(employee_number, address, date_hired, emergency_contact)')
        .eq('id', userId)
        .single();
      if (error) throw error;
      const d = data.officer_details;
      const contact = emergencyContactSchema.safeParse(d?.emergency_contact);
      return {
        phone: data.phone,
        employeeNumber: d?.employee_number ?? null,
        address: d?.address ?? null,
        dateHired: d?.date_hired ?? null,
        emergencyContact: contact.success ? contact.data : null,
      };
    },
  });
}

export function useMyQualifications(userId: string) {
  return useQuery({
    queryKey: queryKeys.myQualifications(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qualifications')
        .select('id, type, license_number, issued_on, expires_on, document_path')
        .eq('user_id', userId)
        .order('expires_on', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });
}

export type MySite = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  emergencyInstructions: string | null;
  contacts: SiteContact[];
};

export function useMySites(userId: string) {
  return useQuery({
    queryKey: queryKeys.mySites(userId),
    queryFn: async (): Promise<MySite[]> => {
      const { data, error } = await supabase
        .from('site_assignments')
        .select(
          'sites(id, name, address, latitude, longitude, emergency_instructions, site_contacts, active)',
        )
        .eq('officer_id', userId);
      if (error) throw error;
      return data
        .flatMap((row) => (row.sites && row.sites.active ? [row.sites] : []))
        .map((s) => {
          return {
            id: s.id,
            name: s.name,
            address: s.address,
            latitude: s.latitude,
            longitude: s.longitude,
            emergencyInstructions: s.emergency_instructions,
            contacts: parseSiteContacts(s.site_contacts),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/**
 * Opens one of the user's own licence scans. Storage RLS only lets officers
 * read files in their own folder; the signed link works for 60 seconds and
 * opens in an in-app browser, so nothing is saved on the phone.
 */
export async function openLicenceScan(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(LICENSES_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return error?.message ?? 'Could not open the scan.';
  await WebBrowser.openBrowserAsync(data.signedUrl);
  return null;
}
