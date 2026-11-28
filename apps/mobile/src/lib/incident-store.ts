import type { IncidentCategory, IncidentSeverity } from '@deltaguard/shared';
import { Directory, File, Paths } from 'expo-file-system';
import { readEncryptedText, writeEncryptedText } from './vault';

// Incident reports that live on this phone: drafts being written, and
// submitted reports waiting to be sent (the offline queue). See
// src/lib/incident-sync.tsx for how the queue is sent.
//
// Storage: the app's private document directory (sandboxed by the OS and
// encrypted at rest with the phone's lock), one folder per signed-in user:
//   incidents/<user id>/reports.json        every local report (this file)
//   incidents/<user id>/<report id>/<photo id>.jpg
// Photos are already compressed and stripped of metadata when they get here
// (see incident-photos.ts). Everything for a report is deleted once the
// server has it.

export type IncidentFormState = {
  siteId: string | null;
  shiftId: string | null;
  /** YYYY-MM-DD and HH:MM in the company time zone, as typed. */
  date: string;
  time: string;
  category: IncidentCategory | null;
  severity: IncidentSeverity | null;
  description: string;
  peopleInvolved: string;
  policeCalled: boolean;
};

export type LocalPhoto = {
  id: string;
  /** file:// URI of the compressed JPEG on this phone. */
  localUri: string;
  /** Already in the incident-photos bucket (kept across retries). */
  uploaded: boolean;
};

export type LocalIncident = {
  /** Also the server id: chosen here so a retried submit can't create a duplicate. */
  id: string;
  /** new: never submitted. resubmit: editing a report the reviewer returned. */
  mode: 'new' | 'resubmit';
  form: IncidentFormState;
  photos: LocalPhoto[];
  /** resubmit: photos already on the server (kept; new ones are added). */
  existingPhotoCount: number;
  /** resubmit: the site on the server (its shift link is kept while the site is unchanged). */
  originalSiteId: string | null;
  /** resubmit: what the reviewer asked for. */
  reviewNotes: string | null;
  /**
   * draft: being written, editable.
   * queued: submitted, waiting to be sent (retries until it gets through).
   * failed: the server refused it (retrying won't help); the officer must edit it.
   */
  state: 'draft' | 'queued' | 'failed';
  /**
   * The form exactly as submitted. Sent as-is, so a time typed as "now" is
   * not re-read later.
   */
  payload: SubmitPayload | null;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  updatedAt: number;
  queuedAt: number | null;
};

/** submit_incident() arguments, minus the photo paths (built when sending). */
export type SubmitPayload = {
  p_id: string;
  p_site_id: string;
  p_shift_id: string | null;
  p_occurred_at: string;
  p_category: IncidentCategory;
  p_severity: IncidentSeverity;
  p_description: string;
  p_people_involved: string | null;
  p_police_called: boolean;
};

export function userDir(userId: string): Directory {
  return new Directory(Paths.document, 'incidents', userId);
}

export function reportDir(userId: string, incidentId: string): Directory {
  return new Directory(userDir(userId), incidentId);
}

function indexFile(userId: string): File {
  return new File(userDir(userId), 'reports.json');
}

function isLocalIncident(value: unknown): value is LocalIncident {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    (v.state === 'draft' || v.state === 'queued' || v.state === 'failed') &&
    Array.isArray(v.photos) &&
    typeof v.form === 'object' &&
    v.form !== null
  );
}

async function load(userId: string): Promise<LocalIncident[]> {
  const file = indexFile(userId);
  if (!file.exists) return [];
  try {
    const parsed: unknown = JSON.parse(await readEncryptedText(file, userId));
    return Array.isArray(parsed) ? parsed.filter(isLocalIncident) : [];
  } catch {
    return [];
  }
}

async function save(userId: string, items: LocalIncident[]): Promise<void> {
  const dir = userDir(userId);
  dir.create({ intermediates: true, idempotent: true });
  // Encrypted (lib/vault.ts), written to a new file and swapped in so a crash
  // mid-write can't leave a half-written index.
  await writeEncryptedText(indexFile(userId), userId, JSON.stringify(items));
}

// Every read-modify-write runs one at a time, so autosave and the sync loop
// can't overwrite each other's changes.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function readAll(userId: string): Promise<LocalIncident[]> {
  return exclusive(() => load(userId));
}

/**
 * Changes one report (or creates it when `fn` gets null) and returns the
 * updated list. Returning null from `fn` removes the report.
 */
export function updateIncident(
  userId: string,
  id: string,
  fn: (current: LocalIncident | null) => LocalIncident | null,
): Promise<LocalIncident[]> {
  return exclusive(async () => {
    const items = await load(userId);
    const index = items.findIndex((i) => i.id === id);
    const next = fn(index >= 0 ? items[index]! : null);
    if (next === null) {
      if (index >= 0) items.splice(index, 1);
    } else if (index >= 0) {
      items[index] = next;
    } else {
      items.push(next);
    }
    await save(userId, items);
    return items;
  });
}

/** Deletes a report's photos from the phone. */
export function deleteReportFiles(userId: string, incidentId: string): void {
  const dir = reportDir(userId, incidentId);
  try {
    if (dir.exists) dir.delete();
  } catch {
    // Nothing useful to do; the folder is retried on the next delete.
  }
}
