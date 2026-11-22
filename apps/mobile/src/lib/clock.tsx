import { type AttendanceType, type ClockEventInput, clockEventSchema } from '@deltaguard/shared';
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

import {
  type AttendanceEvent,
  type DeliveryReport,
  enqueue,
  flushQueue,
  type QueuedClockEvent,
  readQueue,
  sendClockEvent,
} from './clock-queue';
import { getOrCreateDeviceId } from './device';
import type { Fix } from './location';
import { acceptedEvent, type CompanySettings, type MyShift, shiftKeys } from './shifts';

// ---------------------------------------------------------------------------
// Which button a shift shows
// ---------------------------------------------------------------------------

/**
 * Clock in, clock out, or nothing, for this shift right now. Mirrors the
 * server's rules in clock_event() so the button only shows when it can work;
 * the server still decides. Events waiting in the offline queue count as done.
 */
export function clockActionFor(
  shift: MyShift,
  settings: CompanySettings,
  pending: readonly QueuedClockEvent[],
  now: number = Date.now(),
): AttendanceType | null {
  if (shift.status === 'cancelled' || shift.status === 'completed') return null;
  const queued = (type: AttendanceType) =>
    pending.some((q) => q.input.p_shift_id === shift.id && q.input.p_type === type);
  const clockedIn = acceptedEvent(shift, 'clock_in') !== null || queued('clock_in');
  const clockedOut = acceptedEvent(shift, 'clock_out') !== null || queued('clock_out');

  if (clockedIn) return clockedOut ? null : 'clock_out';
  const opensAt = Date.parse(shift.startsAt) - settings.earlyClockInMinutes * 60_000;
  return now >= opensAt && now < Date.parse(shift.endsAt) ? 'clock_in' : null;
}

/** The shift to put front and centre: one to clock out of, else one to clock in to. */
export function currentShift(
  shifts: readonly MyShift[],
  settings: CompanySettings,
  pending: readonly QueuedClockEvent[],
  now: number = Date.now(),
): MyShift | null {
  return (
    shifts.find((s) => clockActionFor(s, settings, pending, now) === 'clock_out') ??
    shifts.find((s) => clockActionFor(s, settings, pending, now) === 'clock_in') ??
    null
  );
}

// ---------------------------------------------------------------------------
// Submitting, and the offline queue
// ---------------------------------------------------------------------------

export type SubmitOutcome =
  | { kind: 'recorded'; event: AttendanceEvent }
  | { kind: 'queued'; deviceTime: string }
  | { kind: 'error'; message: string; code?: string };

type ClockContextValue = {
  /** Events saved on this phone, waiting for a connection. */
  pending: QueuedClockEvent[];
  /** Queued events that have since been sent (or refused), until dismissed. */
  reports: DeliveryReport[];
  dismissReport: (id: string) => void;
  /** Try to send the queue now. */
  flush: () => Promise<void>;
  flushing: boolean;
  submit: (
    shiftId: string,
    type: AttendanceType,
    fix: Fix,
    handoverNote?: string,
  ) => Promise<SubmitOutcome>;
};

const ClockContext = createContext<ClockContextValue | null>(null);

export function useClock() {
  const value = use(ClockContext);
  if (!value) throw new Error('useClock must be used inside <ClockProvider>');
  return value;
}

/** While anything is queued, try again this often (in case no network event fires). */
const RETRY_EVERY_MS = 60_000;

async function looksOffline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  // isInternetReachable can be undefined while the OS is still checking: only
  // an explicit false counts as offline. Anything else, just try the request.
  return state?.isConnected === false || state?.isInternetReachable === false;
}

export function ClockProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<QueuedClockEvent[]>([]);
  const [reports, setReports] = useState<DeliveryReport[]>([]);
  const [flushing, setFlushing] = useState(false);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const refreshShifts = useCallback(
    () => queryClient.invalidateQueries({ queryKey: shiftKeys.mine(userId) }),
    [queryClient, userId],
  );

  const flush = useCallback(async () => {
    setFlushing(true);
    try {
      const { remaining, reports: delivered } = await flushQueue(userId);
      // The ref too, so a caller awaiting flush() sees the result at once.
      pendingRef.current = remaining;
      setPending(remaining);
      if (delivered.length > 0) {
        setReports((r) => [...r, ...delivered]);
        void refreshShifts();
      }
    } finally {
      setFlushing(false);
    }
  }, [userId, refreshShifts]);

  // Load what's queued, and send it, when the officer opens the app.
  useEffect(() => {
    let cancelled = false;
    void readQueue(userId).then((q) => {
      if (cancelled) return;
      setPending(q);
      if (q.length > 0) void flush();
    });
    return () => {
      cancelled = true;
    };
  }, [userId, flush]);

  // Send as soon as the phone is back online or the app comes to the front.
  useEffect(() => {
    const network = Network.addNetworkStateListener((state) => {
      if (
        pendingRef.current.length > 0 &&
        state.isConnected &&
        state.isInternetReachable !== false
      ) {
        void flush();
      }
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active' && pendingRef.current.length > 0) void flush();
    });
    return () => {
      network.remove();
      app.remove();
    };
  }, [flush]);

  useEffect(() => {
    if (pending.length === 0) return;
    const timer = setInterval(() => void flush(), RETRY_EVERY_MS);
    return () => clearInterval(timer);
  }, [pending.length, flush]);

  const submit = useCallback(
    async (
      shiftId: string,
      type: AttendanceType,
      fix: Fix,
      handoverNote?: string,
    ): Promise<SubmitOutcome> => {
      const parsed = clockEventSchema.safeParse({
        p_shift_id: shiftId,
        p_type: type,
        p_latitude: fix.latitude,
        p_longitude: fix.longitude,
        p_accuracy_m: fix.accuracyM,
        p_is_mock_location: fix.isMock,
        p_device_id: await getOrCreateDeviceId(),
        p_device_time: new Date().toISOString(),
        // Saved with the event, so it also goes through the offline queue.
        ...(type === 'clock_out' && handoverNote?.trim()
          ? { p_handover_note: handoverNote.trim() }
          : {}),
      } satisfies ClockEventInput);
      if (!parsed.success) {
        return { kind: 'error', message: 'Your phone gave an invalid location. Try again.' };
      }
      const input = parsed.data;

      const queue = async (): Promise<SubmitOutcome> => {
        const updated = await enqueue(userId, input);
        pendingRef.current = updated;
        setPending(updated);
        return { kind: 'queued', deviceTime: input.p_device_time! };
      };

      if (await looksOffline()) return queue();

      // Older queued events go first: the server needs a queued clock-in
      // before it will take this clock-out.
      if (pendingRef.current.length > 0) {
        await flush();
        if (pendingRef.current.length > 0) return queue();
      }

      const result = await sendClockEvent(input);
      if (result.kind === 'offline') return queue();
      if (result.kind === 'error')
        return { kind: 'error', message: result.message, code: result.code };
      void refreshShifts();
      return { kind: 'recorded', event: result.event };
    },
    [userId, flush, refreshShifts],
  );

  const dismissReport = useCallback(
    (id: string) => setReports((r) => r.filter((x) => x.id !== id)),
    [],
  );

  const value = useMemo(
    () => ({ pending, reports, dismissReport, flush, flushing, submit }),
    [pending, reports, dismissReport, flush, flushing, submit],
  );
  return <ClockContext value={value}>{children}</ClockContext>;
}
