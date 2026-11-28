import { FORM_SUBMISSIONS_BUCKET } from '@deltaguard/shared';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
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

import { getOrCreateDeviceId } from './device';
import { deleteFormFiles, type LocalForm, readAllForms, updateForm } from './form-store';
import { formKeys } from './forms';
import { isOfflineState, looksOffline } from './network';
import { supabase } from './supabase';
import { readEncryptedBytes } from './vault';

// The forms offline queue (same design as the incident queue in
// incident-sync.tsx).
//
// Submitting never talks to the server directly: after the officer confirms
// (and passes the biometric check) the local form is marked `queued` and this
// loop wakes up. For each queued form, oldest first:
//   1. make sure the server row exists (insert with the id chosen on the phone;
//      "duplicate" means an earlier try got through) and save the answers;
//   2. upload the signature PNG to form-submissions/<user>/<form>/signature-*.png
//      ("already exists" = done) and attach it to the row;
//   3. call the Edge Function generate-filled-pdf, which validates the answers,
//      builds the signed, flattened PDF and marks the form submitted.
// Every step is saved to disk as it succeeds, so a retry continues where it
// stopped. No signal, timeouts, server errors and expired sessions are
// retried with a growing delay (30 s ... 15 min) and at once when the phone is
// back online or the app is opened. If the server refuses the form (a required
// answer is missing, it is no longer assigned), it becomes `failed` with the
// reason and the officer fixes it and submits again.

type Failure = { transient: boolean; message: string; problems?: Record<string, string> };

const CHECK_EVERY_MS = 30_000;

function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

function isTransientStatus(status: number | undefined): boolean {
  return !status || status >= 500 || [401, 408, 429].includes(status);
}

type Patch = (current: LocalForm) => LocalForm;

async function ensureRow(item: LocalForm, deviceId: string, patch: (fn: Patch) => Promise<void>) {
  if (!item.serverRow) {
    const { error, status } = await supabase.from('form_submissions').insert({
      id: item.id,
      template_id: item.templateId,
      assignment_id: item.assignmentId,
      values: item.values as never,
      device_id: deviceId,
    });
    // 23505: the row is already there (an earlier try's answer was lost).
    if (error && error.code !== '23505') {
      return {
        transient: isTransientStatus(status),
        message:
          error.code === '42501'
            ? 'This form is no longer assigned to you. Ask your supervisor.'
            : error.message,
      } satisfies Failure;
    }
    await patch((c) => ({ ...c, serverRow: true }));
    if (!error) return null;
  }

  const { data, error, status } = await supabase
    .from('form_submissions')
    .update({ values: item.values as never, device_id: deviceId })
    .eq('id', item.id)
    .select('status');
  if (error)
    return { transient: isTransientStatus(status), message: error.message } satisfies Failure;
  if (data.length === 0) {
    // Not editable any more: already submitted (an earlier try finished)?
    const { data: row } = await supabase
      .from('form_submissions')
      .select('status')
      .eq('id', item.id)
      .maybeSingle();
    if (row && (row.status === 'submitted' || row.status === 'approved')) return 'done' as const;
    return { transient: false, message: 'This form can no longer be changed.' } satisfies Failure;
  }
  return null;
}

async function sendSignature(
  userId: string,
  item: LocalForm,
  patch: (fn: Patch) => Promise<void>,
) {
  const sig = item.signature;
  if (!sig) return null;
  if (!sig.uploaded) {
    let bytes: Uint8Array;
    try {
      // Decrypted in memory for the upload (lib/vault.ts).
      bytes = await readEncryptedBytes(sig.localUri, userId);
    } catch {
      return {
        transient: false,
        message: 'The signature is missing from this phone. Sign again.',
      } satisfies Failure;
    }
    const { error } = await supabase.storage
      .from(FORM_SUBMISSIONS_BUCKET)
      .upload(sig.path, bytes, { contentType: 'image/png', upsert: false });
    if (error) {
      const e = error as { status?: number; statusCode?: string; message: string };
      const exists =
        e.statusCode === '409' || e.status === 409 || /already exists|duplicate/i.test(e.message);
      if (!exists) {
        const status = e.status ?? (e.statusCode ? Number(e.statusCode) : undefined);
        return { transient: isTransientStatus(status), message: e.message } satisfies Failure;
      }
    }
    await patch((c) => (c.signature ? { ...c, signature: { ...c.signature, uploaded: true } } : c));
  }
  if (!sig.attached) {
    const { error, status } = await supabase
      .from('form_submissions')
      .update({ signature_path: sig.path })
      .eq('id', item.id);
    if (error)
      return { transient: isTransientStatus(status), message: error.message } satisfies Failure;
    await patch((c) => (c.signature ? { ...c, signature: { ...c.signature, attached: true } } : c));
  }
  return null;
}

async function callGenerate(id: string): Promise<Failure | null> {
  const { error } = await supabase.functions.invoke('generate-filled-pdf', {
    body: { submission_id: id },
  });
  if (!error) return null;
  if (!(error instanceof FunctionsHttpError)) {
    return { transient: true, message: 'Could not reach the server.' };
  }
  const response = error.context as Response;
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    problems?: { key: string; message: string }[];
  } | null;
  const message = body?.error ?? `Server error ${response.status}`;
  if (response.status === 409 && /already submitted/i.test(message)) return null;
  if (response.status === 422) {
    return {
      transient: false,
      message,
      problems: Object.fromEntries((body?.problems ?? []).map((p) => [p.key, p.message])),
    };
  }
  // 409 "changed while submitting": try again.
  if (response.status === 409 && /changed/i.test(message)) return { transient: true, message };
  return { transient: isTransientStatus(response.status), message };
}

/** Sends one queued form. Returns null when the server has it. */
async function sendOne(userId: string, id: string): Promise<Failure | null> {
  const patch = async (fn: Patch) => {
    await updateForm(userId, id, (c) => (c ? fn(c) : null));
  };
  const read = async () => (await readAllForms(userId)).find((f) => f.id === id) ?? null;

  let item = await read();
  if (!item) return null;
  try {
    const deviceId = await getOrCreateDeviceId();
    const row = await ensureRow(item, deviceId, patch);
    if (row === 'done') return null;
    if (row) return row;
    item = (await read()) ?? item;
    const sig = await sendSignature(userId, item, patch);
    if (sig) return sig;
    return await callGenerate(id);
  } catch (e) {
    return { transient: true, message: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type FormSyncValue = {
  items: LocalForm[];
  loaded: boolean;
  sendingId: string | null;
  save: (id: string, fn: (current: LocalForm | null) => LocalForm | null) => Promise<LocalForm[]>;
  /** Queue a confirmed form and try to send it now. */
  submit: (id: string) => Promise<void>;
  syncNow: () => Promise<void>;
};

const FormSyncContext = createContext<FormSyncValue | null>(null);

export function useFormSync() {
  const value = use(FormSyncContext);
  if (!value) throw new Error('useFormSync must be used inside <FormSyncProvider>');
  return value;
}

export function FormSyncProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<LocalForm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const running = useRef(false);
  const again = useRef(false);

  const save = useCallback<FormSyncValue['save']>(
    async (id, fn) => {
      const updated = await updateForm(userId, id, fn);
      setItems(updated);
      return updated;
    },
    [userId],
  );

  const run = useCallback(
    async function run(force: boolean): Promise<void> {
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      try {
        if (await looksOffline()) return;
        const due = (await readAllForms(userId))
          .filter((i) => i.state === 'queued' && (force || (i.nextAttemptAt ?? 0) <= Date.now()))
          .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));

        for (const item of due) {
          setSendingId(item.id);
          const failure = await sendOne(userId, item.id);
          if (!failure) {
            await save(item.id, () => null);
            deleteFormFiles(userId, item.id);
            void queryClient.invalidateQueries({ queryKey: formKeys.all });
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
                : {
                    ...current,
                    state: 'failed',
                    lastError: failure.message,
                    problems: failure.problems ?? {},
                    nextAttemptAt: null,
                  }
              : null,
          );
          if (failure.transient) break;
        }
      } finally {
        setSendingId(null);
        running.current = false;
        setItems(await readAllForms(userId));
      }
      if (again.current) {
        again.current = false;
        await run(true);
      }
    },
    [userId, save, queryClient],
  );

  useEffect(() => {
    let cancelled = false;
    void readAllForms(userId).then((all) => {
      if (cancelled) return;
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
      if (!isOfflineState(state)) void run(true);
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

  const submit = useCallback(
    async (id: string) => {
      await save(id, (c) =>
        c
          ? {
              ...c,
              state: 'queued',
              queuedAt: Date.now(),
              confirmedAt: Date.now(),
              attempts: 0,
              nextAttemptAt: null,
              lastError: null,
              problems: {},
            }
          : null,
      );
      void run(true);
    },
    [save, run],
  );

  const syncNow = useCallback(() => run(true), [run]);

  const value = useMemo(
    () => ({ items, loaded, sendingId, save, submit, syncNow }),
    [items, loaded, sendingId, save, submit, syncNow],
  );
  return <FormSyncContext value={value}>{children}</FormSyncContext>;
}
