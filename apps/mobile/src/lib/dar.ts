import {
  DAR_PHOTO_MAX_BYTES,
  DAR_PHOTOS_BUCKET,
  type DarEntryType,
  darEntrySchema,
} from '@deltaguard/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { supabase } from './supabase';

// Daily activity reports. clock_event() creates a shift's report at clock-in;
// officers then add entries (append-only). RLS keeps officers to their own
// reports; photos live in the private dar-photos bucket under
// <officer_id>/<report_id>/.

export const darKeys = {
  report: (shiftId: string) => ['dar', shiftId] as const,
  handover: (shiftId: string) => ['handover', shiftId] as const,
  photo: (path: string) => ['dar-photo', path] as const,
};

export type DarEntry = {
  id: string;
  occurredAt: string;
  type: DarEntryType;
  description: string;
  photoPath: string | null;
};

export type ShiftReport = { id: string; entries: DarEntry[] };

/** The report of one of the officer's shifts, or null before clock-in. */
export function useShiftReport(shiftId: string) {
  return useQuery({
    queryKey: darKeys.report(shiftId),
    queryFn: async (): Promise<ShiftReport | null> => {
      const { data, error } = await supabase
        .from('daily_activity_reports')
        .select('id, dar_entries(id, occurred_at, type, description, photo_path)')
        .eq('shift_id', shiftId)
        .order('occurred_at', { referencedTable: 'dar_entries', ascending: false })
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        entries: data.dar_entries.map((e) => ({
          id: e.id,
          occurredAt: e.occurred_at,
          type: e.type,
          description: e.description,
          photoPath: e.photo_path,
        })),
      };
    },
  });
}

export type PickedPhoto = { base64: string; mimeType: string; uri: string };

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uploadPhoto(userId: string, reportId: string, photo: PickedPhoto): Promise<string> {
  const ext = EXTENSIONS[photo.mimeType];
  if (!ext) throw new Error('This kind of photo isn’t supported. Use a JPEG or PNG.');
  const bytes = decodeBase64(photo.base64);
  if (bytes.byteLength > DAR_PHOTO_MAX_BYTES)
    throw new Error('The photo is too large (10 MB max).');
  const path = `${userId}/${reportId}/${Crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(DAR_PHOTOS_BUCKET)
    .upload(path, bytes, { contentType: photo.mimeType, upsert: false });
  if (error) throw new Error(`Couldn’t upload the photo: ${error.message}`);
  return path;
}

export function useAddDarEntry(shiftId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      reportId: string;
      type: DarEntryType;
      description: string;
      photo: PickedPhoto | null;
    }) => {
      // Validate before uploading anything.
      darEntrySchema.parse({
        report_id: input.reportId,
        type: input.type,
        description: input.description,
      });
      const photoPath = input.photo ? await uploadPhoto(userId, input.reportId, input.photo) : null;
      const entry = darEntrySchema.parse({
        report_id: input.reportId,
        type: input.type,
        description: input.description,
        photo_path: photoPath,
      });
      // officer_id is required by the type; the database sets it from the report.
      const { error } = await supabase.from('dar_entries').insert({ ...entry, officer_id: userId });
      if (error) throw new Error(error.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: darKeys.report(shiftId) }),
  });
}

/** A short-lived link to view one of the officer's own report photos. */
export function usePhotoUrl(path: string | null) {
  return useQuery({
    queryKey: darKeys.photo(path ?? ''),
    enabled: Boolean(path),
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(DAR_PHOTOS_BUCKET)
        .createSignedUrl(path!, 15 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 10 * 60_000,
  });
}

export type HandoverNote = {
  id: string;
  note: string;
  notedAt: string;
  officerName: string | null;
};

/** Handover notes left at this shift's site by the officers before. */
export function useHandover(shiftId: string, enabled = true) {
  return useQuery({
    queryKey: darKeys.handover(shiftId),
    enabled,
    queryFn: async (): Promise<HandoverNote[]> => {
      const { data, error } = await supabase.rpc('shift_handover', { p_shift_id: shiftId });
      if (error) throw error;
      return data.map((h) => ({
        id: h.entry_id,
        note: h.note,
        notedAt: h.noted_at,
        officerName: h.officer_name,
      }));
    },
    staleTime: 60_000,
  });
}
