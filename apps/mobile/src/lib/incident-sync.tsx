import { INCIDENT_PHOTOS_BUCKET, submitIncidentSchema } from '@deltaguard/shared';
import { useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import * as Network from 'expo-network';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import {
  deleteReportFiles,
  type LocalIncident,
  readAll,
  type SubmitPayload,
  updateIncident,
} from './incident-store';
import { incidentKeys } from './incidents';
import { supabase } from './supabase';

// The incident offline queue.
//
// Submitting a report never talks to the server directly: it marks the local
// report `queued` (with the form frozen as `payload`) and wakes this loop.
// For each queued report, oldest first, the loop:
//   1. uploads each photo not yet marked `uploaded` to
//      incident-photos/<user>/<report id>/<photo id>.jpg, marking it uploaded
//      (saved to disk) as soon as it is in, so a retry skips it;
//   2. calls submit_incident(), which writes the report and its photo rows in
//      one transaction;
//   3. on success, deletes the report and its photos from the phone.
// Both steps are safe to repeat: an upload that already happened answers
// "already exists" (treated as done), and submit_incident() returns the
// existing report when that id was already submitted.
//
// When it can't get through (no signal, timeout, server error, expired
// session) the report stays queued and is retried with a growing delay
// (30 s, 1, 2, 4, 8, then every 15 min), and at once when the phone comes
// back online or the app is opened. If the server refuses the report
// (e.g. the officer has been removed from the site), retrying can't help:
// it becomes `failed` with the reason, and the officer edits and resubmits.

type Failure = { transient: boolean; message: string };

const REQUEST_TIMEOUT_MS = 30_000;
const CHECK_EVERY_MS = 30_000;

function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

/** No answer, timeouts, rate limits, server errors and auth refreshes are worth retrying. */
function isTransientStatus(status: number | undefined): boolean {
  return !status || status >= 500 || [401, 408, 429].includes(status);
}

export function photoPath(userId: string, incidentId: string, photoId: string): string {
  return `${userId}/${incidentId}/${photoId}.jpg`;
}

async function uploadPhoto(path: string, localUri: string): Promise<Failure | null> {
  let bytes: Uint8Array;
  try {
    bytes = await new File(localUri).bytes();
  } catch {
    return {
      transient: false,
      message: 'A photo is missing from this phone. Remove it and resubmit.',
    };
  }
  try {
    const { error } = await supabase.storage
      .from(INCIDENT_PHOTOS_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (!error) return null;
    const e = error as { status?: number; statusCode?: string; message: string };
    // Uploaded by an earlier try whose answer was lost.
    if (e.statusCode === '409' || e.status === 409 || /already exists|duplicate/i.test(e.message)) {
      return null;
    }
    const status = e.status ?? (e.statusCode ? Number(e.statusCode) : undefined);
    return { transient: isTransientStatus(status), message: e.message };
  } catch (e) {
    return { transient: true, message: (e as Error).message };
  }
}

async function callSubmit(payload: SubmitPayload, paths: string[]): Promise<Failure | null> {
  const parsed = submitIncidentSchema.safeParse({ ...payload, p_photo_paths: paths });
  if (!parsed.success) {
    return { transient: false, message: 'Some details are missing or invalid. Edit the report.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const { error, status } = await supabase
      // Generated types mark every argument non-null; these two accept null.
      .rpc('submit_incident', {
        ...parsed.data,
        p_shift_id: parsed.data.p_shift_id as string,
        p_people_involved: parsed.data.p_people_involved as string,
      })
      .abortSignal(controller.signal);
    if (!error) return null;
    return { transient: isTransientStatus(status), message: error.message };
  } catch (e) {
    return { transient: true, message: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Sends one queued report. Returns null when the server has it. */
async function sendOne(
  userId: string,
  item: LocalIncident,
  onProgress: () => void,
): Promise<Failure | null> {
  if (!item.payload) return { transient: false, message: 'Nothing to send. Edit the report.' };

  for (const photo of item.photos) {
    if (photo.uploaded) continue;
    const failure = await uploadPhoto(photoPath(userId, item.id, photo.id), photo.localUri);
    if (failure) return failure;
    await updateIncident(userId, item.id, (current) =>
      current
        ? {
            ...current,
            photos: current.photos.map((p) => (p.id === photo.id ? { ...p, uploaded: true } : p)),
          }
        : null,
    );
    onProgress();
  }

  return callSubmit(
    item.payload,
    item.photos.map((p) => photoPath(userId, item.id, p.id)),
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type IncidentSyncValue = {
  /** Every report on this phone (drafts, queued, failed). */
  items: LocalIncident[];
  loaded: boolean;
  /** The report being sent right now, if any. */
  sendingId: string | null;
  save: (
    id: string,
    fn: (current: LocalIncident | null) => LocalIncident | null,
  ) => Promise<LocalIncident[]>;
  /** Try to send everything queued now, ignoring the retry delay. */
  syncNow: () => Promise<void>;
};

const IncidentSyncContext = createContext<IncidentSyncValue | null>(null);

export function useIncidentSync() {
  const value = use(IncidentSyncContext);
  if (!value) throw new Error('useIncidentSync must be used inside <IncidentSyncProvider>');
  return value;
}

async function looksOffline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return state?.isConnected === false || state?.isInternetReachable === false;
}

export function IncidentSyncProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<LocalIncident[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const running = useRef(false);
  // A run was asked for while one was in progress: go again when it ends.
  const again = useRef(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const save = useCallback<IncidentSyncValue['save']>(
    async (id, fn) => {
      const updated = await updateIncident(userId, id, fn);
      itemsRef.current = updated;
      setItems(updated);
      return updated;
    },
    [userId],
  );

  const reload = useCallback(async () => {
    const all = await readAll(userId);
    itemsRef.current = all;
    setItems(all);
  }, [userId]);

  /** One pass over the queue. `force` ignores each report's retry delay. */
  const run = useCallback(
    async function run(force: boolean): Promise<void> {
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      try {
        if (await looksOffline()) return;
        const due = (await readAll(userId))
          .filter((i) => i.state === 'queued' && (force || (i.nextAttemptAt ?? 0) <= Date.now()))
          .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));

        for (const item of due) {
          setSendingId(item.id);
          const failure = await sendOne(userId, item, () => void reload());
          if (!failure) {
            await save(item.id, () => null);
            deleteReportFiles(userId, item.id);
            void queryClient.invalidateQueries({ queryKey: incidentKeys.all });
            continue;
          }
          await save(item.id, (current) =>
            current
              ? failure.transient
                ? {
                    ...current,
                    attempts: current.attempts + 1,
                    nextAttemptAt: Date.now() + backoffMs(current.attempts + 1),
                    lastError: failure.message,
                  }
                : { ...current, state: 'failed', lastError: failure.message, nextAttemptAt: null }
              : null,
          );
          // No connection: the rest would fail the same way.
          if (failure.transient) break;
        }
      } finally {
        setSendingId(null);
        running.current = false;
      }
      if (again.current) {
        again.current = false;
        await run(true);
      }
    },
    [userId, save, reload, queryClient],
  );

  // Load on start, then send anything left from last time.
  useEffect(() => {
    let cancelled = false;
    void readAll(userId).then((all) => {
      if (cancelled) return;
      itemsRef.current = all;
      setItems(all);
      setLoaded(true);
      void run(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, run]);

  const hasQueued = items.some((i) => i.state === 'queued');

  useEffect(() => {
    if (!hasQueued) return;
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void run(true);
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run(true);
    });
    const timer = setInterval(() => void run(false), CHECK_EVERY_MS);
    return () => {
      network.remove();
      app.remove();
      clearInterval(timer);
    };
  }, [hasQueued, run]);

  const syncNow = useCallback(() => run(true), [run]);

  const value = useMemo(
    () => ({ items, loaded, sendingId, save, syncNow }),
    [items, loaded, sendingId, save, syncNow],
  );
  return <IncidentSyncContext value={value}>{children}</IncidentSyncContext>;
}

// ---------------------------------------------------------------------------
// Status shown to the officer
// ---------------------------------------------------------------------------

export type SyncStatus =
  | { kind: 'draft' }
  | { kind: 'sending'; uploaded: number; total: number }
  | {
      kind: 'waiting';
      uploaded: number;
      total: number;
      retryAt: number | null;
      error: string | null;
    }
  | { kind: 'failed'; error: string };

export function syncStatus(item: LocalIncident, sendingId: string | null): SyncStatus {
  const total = item.photos.length;
  const uploaded = item.photos.filter((p) => p.uploaded).length;
  if (item.state === 'draft') return { kind: 'draft' };
  if (item.state === 'failed') return { kind: 'failed', error: item.lastError ?? 'Refused' };
  if (sendingId === item.id) return { kind: 'sending', uploaded, total };
  return {
    kind: 'waiting',
    uploaded,
    total,
    retryAt: item.nextAttemptAt,
    error: item.attempts > 0 ? item.lastError : null,
  };
}
