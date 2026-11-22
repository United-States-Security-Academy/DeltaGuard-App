import { type ClockEventInput, clockEventSchema, type Tables } from '@deltaguard/shared';
import * as Crypto from 'expo-crypto';

import { secureStorage } from './secure-storage';
import { supabase } from './supabase';

// Clock events made with no internet. The GPS fix and the phone's time are
// taken when the officer taps the button and saved here; they're sent later
// with p_queued = true, so the server checks them against the phone's time and
// flags them `delayed` for supervisors (see the Phase 5 migration).
//
// Saved in the Keychain / Keystore (the event contains a location), one queue
// per user, so it survives the app being closed and is only ever sent with the
// session of the officer who made it.

export type AttendanceEvent = Tables<'attendance_events'>;

export type SendResult =
  | { kind: 'ok'; event: AttendanceEvent }
  /** No connection (or the server is unreachable): try again later. */
  | { kind: 'offline' }
  /** The server refused it. Retrying won't help. */
  | { kind: 'error'; message: string; code: string };

const REQUEST_TIMEOUT_MS = 15_000;

/** One call to clock_event(). */
export async function sendClockEvent(input: ClockEventInput): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const { data, error, status } = await supabase
      // The type generator marks every function argument non-null, but
      // clock_event accepts a null accuracy (and flags it low_accuracy).
      .rpc('clock_event', { ...input, p_accuracy_m: input.p_accuracy_m as number })
      .abortSignal(controller.signal);
    if (!error) return { kind: 'ok', event: data };
    // status 0: the request never got an answer (no network, DNS, timeout).
    // 5xx / 408 / 429: the server or a proxy is struggling; worth retrying.
    // 401: the session couldn't be refreshed (it is refreshed when online).
    if (status === 0 || status >= 500 || [401, 408, 429].includes(status)) {
      return { kind: 'offline' };
    }
    return { kind: 'error', message: error.message, code: error.code };
  } catch {
    return { kind: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type QueuedClockEvent = {
  id: string;
  input: ClockEventInput;
  /** Failed sends so far (no connection). */
  attempts: number;
};

/** A stored item, or null if it is damaged (it is then dropped). */
function parseItem(value: unknown): QueuedClockEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const input = clockEventSchema.safeParse(v.input);
  if (typeof v.id !== 'string' || !input.success) return null;
  return { id: v.id, input: input.data, attempts: typeof v.attempts === 'number' ? v.attempts : 0 };
}

export type DeliveryReport =
  | { id: string; item: QueuedClockEvent; outcome: 'sent'; event: AttendanceEvent }
  /** The server already had it (e.g. an earlier try got through but the reply was lost). */
  | { id: string; item: QueuedClockEvent; outcome: 'duplicate' }
  | { id: string; item: QueuedClockEvent; outcome: 'failed'; message: string };

const queueKey = (userId: string) => `deltaguard.clock_queue.${userId}`;

// Every read-modify-write of the queue runs one at a time, so a flush and a
// new clock event can't overwrite each other.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function load(userId: string): Promise<QueuedClockEvent[]> {
  const raw = await secureStorage.getItem(queueKey(userId)).catch(() => null);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseItem).filter((q): q is QueuedClockEvent => q !== null);
  } catch {
    return [];
  }
}

async function save(userId: string, queue: QueuedClockEvent[]): Promise<void> {
  if (queue.length === 0) await secureStorage.removeItem(queueKey(userId));
  else await secureStorage.setItem(queueKey(userId), JSON.stringify(queue));
}

const byDeviceTime = (a: QueuedClockEvent, b: QueuedClockEvent) =>
  Date.parse(a.input.p_device_time ?? '') - Date.parse(b.input.p_device_time ?? '');

export function readQueue(userId: string): Promise<QueuedClockEvent[]> {
  return exclusive(() => load(userId));
}

/** Saves an event to send later. Returns the updated queue. */
export function enqueue(userId: string, input: ClockEventInput): Promise<QueuedClockEvent[]> {
  return exclusive(async () => {
    const queue = await load(userId);
    // One clock-in and one clock-out per shift: a newer tap replaces an older one.
    const kept = queue.filter(
      (q) => !(q.input.p_shift_id === input.p_shift_id && q.input.p_type === input.p_type),
    );
    kept.push({ id: Crypto.randomUUID(), input: { ...input, p_queued: true }, attempts: 0 });
    kept.sort(byDeviceTime);
    await save(userId, kept);
    return kept;
  });
}

/**
 * Sends queued events oldest first (a clock-in before its clock-out). Stops
 * at the first one that can't get through, keeping it and everything after it.
 */
export function flushQueue(
  userId: string,
): Promise<{ remaining: QueuedClockEvent[]; reports: DeliveryReport[] }> {
  return exclusive(async () => {
    const queue = await load(userId);
    const reports: DeliveryReport[] = [];

    while (queue.length > 0) {
      const item = queue[0]!;
      const result = await sendClockEvent(item.input);
      if (result.kind === 'offline') {
        item.attempts += 1;
        break;
      }
      queue.shift();
      if (result.kind === 'ok') {
        reports.push({ id: item.id, item, outcome: 'sent', event: result.event });
      } else if (result.code === '23505') {
        reports.push({ id: item.id, item, outcome: 'duplicate' });
      } else {
        reports.push({ id: item.id, item, outcome: 'failed', message: result.message });
      }
      // Save after each one so a crash can't send an event twice.
      await save(userId, queue);
    }

    await save(userId, queue);
    return { remaining: queue, reports };
  });
}
