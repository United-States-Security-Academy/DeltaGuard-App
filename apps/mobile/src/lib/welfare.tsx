import { errorKind } from '@deltaguard/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Battery from 'expo-battery';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Network from 'expo-network';
import { router } from 'expo-router';
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
import { AppState, type AppStateStatus, Vibration } from 'react-native';

import { useNow } from '@/components/clock-panel';

import { authenticateOwner } from './biometric';
import { clockActionFor, useClock } from './clock';
import { getOrCreateDeviceId } from './device';
import { isOfflineState, looksOffline } from './network';
import { type MyShift, useCompanySettings, useMyShifts } from './shifts';
import { supabase } from './supabase';
import {
  type AlertSetup,
  cancelWelfareAlerts,
  clearReturnReminder,
  ensureWelfareChannels,
  notifyDuty,
  readAlertSetup,
  scheduleReturnReminder,
  scheduleWelfareAlerts,
} from './welfare-alerts';
import { tryNative } from './welfare-native';
import {
  EMPTY_WELFARE,
  type NextCheck,
  type QueuedAnswer,
  readWelfare,
  trimAnswered,
  updateWelfare,
  type WelfareLocal,
} from './welfare-store';

// On-duty mode and welfare checks on the phone.
//
// On duty = clocked in to a shift and not yet out (queued offline clock-ins
// count). While on duty: the screen stays awake, the phone sends a heartbeat
// (battery %, app state; no location) every 3 minutes while the app runs,
// warns about low battery or an unplugged charger, and reminds the officer
// to come back if they leave the app.
//
// Checks: the next one (get_next_welfare_check: id + time) is stored on the
// phone and its prompt + alarm are scheduled as local notifications, so they
// fire without internet. When it comes due, the full-screen prompt
// (components/welfare-prompt.tsx) asks for a biometric confirmation; the
// answer goes to respond_welfare_check at once, or waits in a queue with the
// phone's time and is sent when the connection is back. The server then
// makes the next check, which is fetched and scheduled again.

const HEARTBEAT_MS = 3 * 60_000;
const NEXT_REFRESH_MS = 5 * 60_000;
const QUEUE_RETRY_MS = 30_000;
const LOW_BATTERY = 0.2;

export type DueCheck = { id: string; scheduledAt: string; alarmAt: number };

export type BatteryInfo = {
  /** 0..1, or null when unknown. */
  level: number | null;
  charging: boolean | null;
  low: boolean;
  /** The charger was unplugged during this shift (until dismissed). */
  unplugged: boolean;
};

type WelfareContextValue = {
  onDuty: boolean;
  shift: MyShift | null;
  /** A next check is known (false: none scheduled, e.g. no welfare policy for the site). */
  hasNextCheck: boolean;
  /** The check waiting for an answer now (null when none). */
  due: DueCheck | null;
  /** Biometric check, then the answer. Returns an error message, or null. */
  confirm: () => Promise<string | null>;
  /** Answers given on this phone that the server doesn't have yet. */
  queued: QueuedAnswer[];
  answered: Record<string, string>;
  battery: BatteryInfo;
  dismissUnplugged: () => void;
  setup: AlertSetup | null;
  refreshSetup: () => void;
};

const WelfareContext = createContext<WelfareContextValue | null>(null);

export function useWelfare(): WelfareContextValue {
  const value = use(WelfareContext);
  if (!value) throw new Error('useWelfare must be used inside <WelfareProvider>');
  return value;
}

export const welfareKeys = {
  all: ['welfare'] as const,
  next: (userId: string) => ['welfare', 'next', userId] as const,
  history: (shiftId: string) => ['welfare', 'history', shiftId] as const,
};

export type WelfareHistoryItem = {
  id: string;
  scheduledAt: string;
  status: string;
  respondedAt: string | null;
  responseSeconds: number | null;
  flags: string[];
  responseAllowedSeconds: number | null;
};

/** The officer's checks on this shift that have come due (RLS hides later ones). */
export function useWelfareHistory(shiftId: string | null) {
  return useQuery({
    queryKey: welfareKeys.history(shiftId ?? 'none'),
    enabled: shiftId !== null,
    refetchInterval: 2 * 60_000,
    queryFn: async (): Promise<WelfareHistoryItem[]> => {
      const { data, error } = await supabase
        .from('welfare_checks')
        .select('id, scheduled_at, status, responded_at, response_seconds, response_flags, policy')
        .eq('shift_id', shiftId!)
        .order('scheduled_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data.map((c) => {
        const policy = (c.policy ?? {}) as { response_seconds?: unknown };
        return {
          id: c.id,
          scheduledAt: c.scheduled_at,
          status: c.status,
          respondedAt: c.responded_at,
          responseSeconds: c.response_seconds,
          flags: c.response_flags,
          responseAllowedSeconds:
            typeof policy.response_seconds === 'number' ? policy.response_seconds : null,
        };
      });
    },
  });
}

type SendResult = 'sent' | 'offline' | 'retry' | 'drop';

async function sendAnswer(answer: QueuedAnswer, offline: boolean): Promise<SendResult> {
  if (await looksOffline()) return 'offline';
  const { error } = await supabase.rpc('respond_welfare_check', {
    p_check_id: answer.checkId,
    p_responded_at_device: answer.deviceTime,
    p_biometric_verified: answer.biometric,
    p_offline: offline,
    p_device_id: answer.deviceId,
  });
  if (!error) return 'sent';
  if (errorKind(error) === 'offline' || errorKind(error) === 'session') return 'offline';
  // "Not due yet" (the phone's clock is ahead): try again later.
  if (error.code === 'P0001') return 'retry';
  // Not this officer's / bad input: it can never succeed.
  console.warn('respond_welfare_check refused', error.message);
  return 'drop';
}

function appStateValue(
  s: AppStateStatus | string | null | undefined,
): 'active' | 'background' | 'inactive' | 'unknown' {
  return s === 'active' || s === 'background' || s === 'inactive' ? s : 'unknown';
}

export function WelfareProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const shifts = useMyShifts(userId);
  const settings = useCompanySettings();
  const { pending } = useClock();
  const now = useNow(30_000);
  const [local, setLocal] = useState<WelfareLocal>(EMPTY_WELFARE);
  const [loaded, setLoaded] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [dueId, setDueId] = useState<string | null>(null);
  const [setup, setSetup] = useState<AlertSetup | null>(null);
  const [battery, setBattery] = useState<BatteryInfo>({
    level: null,
    charging: null,
    low: false,
    unplugged: false,
  });

  const update = useCallback(
    async (fn: (s: WelfareLocal) => WelfareLocal) => {
      const next = await updateWelfare(userId, fn);
      setLocal(next);
      return next;
    },
    [userId],
  );

  useEffect(() => {
    let cancelled = false;
    void readWelfare(userId).then((s) => {
      if (cancelled) return;
      setLocal(s);
      setLoaded(true);
    });
    // Read while the phone is unlocked (iOS keychain), kept for heartbeats.
    void getOrCreateDeviceId().then((id) => !cancelled && setDeviceId(id));
    void ensureWelfareChannels().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // On duty? Known once the shifts have loaded; before that (e.g. opened
  // offline), a stored next check counts, so its prompt still works.
  const shift =
    (shifts.data ?? []).find((s) => clockActionFor(s, settings, pending, now) === 'clock_out') ??
    null;
  const dutyKnown = shifts.isSuccess;
  const onDuty = dutyKnown ? shift !== null : local.next !== null;

  // ---------------------------------------------------------------------
  // The next check: fetch, store, schedule on the phone
  // ---------------------------------------------------------------------

  const nextQuery = useQuery({
    queryKey: welfareKeys.next(userId),
    enabled: dutyKnown && shift !== null,
    refetchInterval: NEXT_REFRESH_MS,
    queryFn: async (): Promise<{ id: string; scheduledAt: string } | null> => {
      const { data, error } = await supabase.rpc('get_next_welfare_check');
      if (error) throw error;
      const row = data?.[0];
      return row ? { id: row.id, scheduledAt: row.scheduled_at } : null;
    },
  });

  // The policy's time to answer, from the latest check the officer can read.
  const history = useWelfareHistory(shift?.id ?? null);
  const latestAllowed = history.data?.find(
    (h) => h.responseAllowedSeconds !== null,
  )?.responseAllowedSeconds;
  useEffect(() => {
    if (!loaded || !latestAllowed || latestAllowed === local.responseSeconds) return;
    // Stored, and the alarm rescheduled with the new time (scheduledKey reset).
    void (async () => {
      await update((s) => ({ ...s, responseSeconds: latestAllowed, scheduledKey: null }));
    })();
  }, [loaded, latestAllowed, local.responseSeconds, update]);

  const fetched = nextQuery.isSuccess ? nextQuery.data : undefined;
  const shiftId = shift?.id ?? null;
  useEffect(() => {
    if (!loaded || !dutyKnown) return;
    // Off duty: nothing should fire.
    if (shiftId === null) {
      if (local.next === null && local.scheduledKey === null && local.nativeIds.length === 0)
        return;
      void (async () => {
        await cancelWelfareAlerts(local.nativeIds);
        tryNative((m) => m.showOverLockScreen(false));
        await update((s) => ({ ...s, next: null, scheduledKey: null, nativeIds: [] }));
      })();
      return;
    }
    if (fetched === undefined) return; // not fetched yet (or offline): keep what we have
    const key = fetched ? `${fetched.id}@${fetched.scheduledAt}` : null;
    if (key === local.scheduledKey && (fetched?.id ?? null) === (local.next?.id ?? null)) return;
    void (async () => {
      await cancelWelfareAlerts(local.nativeIds);
      const nativeIds =
        fetched && !local.answered[fetched.id]
          ? await scheduleWelfareAlerts(fetched, local.responseSeconds).catch((e) => {
              console.warn('scheduleWelfareAlerts', e);
              return [] as string[];
            })
          : [];
      const next: NextCheck | null = fetched ? { ...fetched, shiftId } : null;
      await update((s) => ({ ...s, next, scheduledKey: key, nativeIds }));
    })();
  }, [loaded, dutyKnown, shiftId, fetched, local, update]);

  // ---------------------------------------------------------------------
  // Due: the stored next check's time has come and it isn't answered here
  // ---------------------------------------------------------------------

  const next = local.next;
  const answeredHere = next ? local.answered[next.id] !== undefined : false;
  useEffect(() => {
    if (!next || answeredHere) return;
    const ms = Date.parse(next.scheduledAt) - Date.now();
    const timer = setTimeout(() => setDueId(next.id), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(timer);
  }, [next, answeredHere]);

  const responseSeconds = local.responseSeconds;
  const due = useMemo<DueCheck | null>(
    () =>
      onDuty && next && !answeredHere && dueId === next.id
        ? {
            id: next.id,
            scheduledAt: next.scheduledAt,
            alarmAt: Date.parse(next.scheduledAt) + responseSeconds * 1000,
          }
        : null,
    [onDuty, next, answeredHere, dueId, responseSeconds],
  );
  const dueCheckId = due?.id ?? null;

  // Android: while a check is due, show the app over the lock screen.
  useEffect(() => {
    tryNative((m) => m.showOverLockScreen(dueCheckId !== null));
  }, [dueCheckId]);

  // ---------------------------------------------------------------------
  // Answering, and the offline queue
  // ---------------------------------------------------------------------

  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const state = await readWelfare(userId);
      for (const answer of state.queue) {
        const result = await sendAnswer(answer, true);
        if (result === 'offline') break;
        await update((s) => ({
          ...s,
          queue:
            result === 'retry'
              ? s.queue.map((q) =>
                  q.checkId === answer.checkId ? { ...q, tries: q.tries + 1 } : q,
                )
              : s.queue.filter((q) => q.checkId !== answer.checkId),
        }));
        if (result === 'sent') {
          void queryClient.invalidateQueries({ queryKey: welfareKeys.all });
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [queryClient, update, userId]);

  const confirm = useCallback(async (): Promise<string | null> => {
    const check = due;
    if (!check) return null;
    const auth = await authenticateOwner('Confirm you are alert');
    if (!auth.ok) return auth.message;
    const deviceTime = new Date().toISOString();
    const answer: QueuedAnswer = {
      checkId: check.id,
      deviceTime,
      biometric: true,
      deviceId: deviceId ?? (await getOrCreateDeviceId()),
      tries: 0,
    };
    const state = await update((s) => ({
      ...s,
      answered: trimAnswered({ ...s.answered, [check.id]: deviceTime }),
    }));
    await cancelWelfareAlerts(state.nativeIds);
    tryNative((m) => m.showOverLockScreen(false));

    // Send now (online answer: server time counts); if that can't happen,
    // queue it with the phone's time.
    void (async () => {
      const result = await sendAnswer(answer, false);
      if (result === 'sent') {
        void queryClient.invalidateQueries({ queryKey: welfareKeys.all });
      } else if (result !== 'drop') {
        await update((s) => ({
          ...s,
          queue: [...s.queue.filter((q) => q.checkId !== answer.checkId), answer],
        }));
      }
    })();
    return null;
  }, [due, deviceId, queryClient, update]);

  // Retry the queue: when the connection or the app comes back, and every 30 s.
  const queueLength = local.queue.length;
  useEffect(() => {
    if (queueLength === 0) return;
    void flush();
    const timer = setInterval(() => void flush(), QUEUE_RETRY_MS);
    const net = Network.addNetworkStateListener((state) => {
      if (!isOfflineState(state)) void flush();
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void flush();
    });
    return () => {
      clearInterval(timer);
      net.remove();
      app.remove();
    };
  }, [queueLength, flush]);

  // ---------------------------------------------------------------------
  // On-duty mode: keep awake, heartbeats, battery, leaving the app
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!onDuty) return;
    void activateKeepAwakeAsync('on-duty').catch(() => undefined);
    return () => {
      void deactivateKeepAwake('on-duty').catch(() => undefined);
    };
  }, [onDuty]);

  useEffect(() => {
    if (!onDuty || !deviceId) return;
    const beat = async () => {
      const level = await Battery.getBatteryLevelAsync().catch(() => -1);
      await supabase
        .rpc('record_device_heartbeat', {
          p_device_id: deviceId,
          p_battery_level: level >= 0 ? Math.round(level * 100) : undefined,
          p_app_state: appStateValue(AppState.currentState),
        })
        .then(({ error }) => error && console.warn('heartbeat', error.message));
    };
    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    const app = AppState.addEventListener('change', () => void beat());
    return () => {
      clearInterval(timer);
      app.remove();
    };
  }, [onDuty, deviceId]);

  useEffect(() => {
    if (!onDuty) return;
    let lastLevel: number | null = null;
    let lastState: Battery.BatteryState | null = null;
    const isCharging = (s: Battery.BatteryState) =>
      s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL;

    const onLevel = (level: number) => {
      if (level < 0) return;
      const low = level < LOW_BATTERY;
      if (low && lastLevel !== null && lastLevel >= LOW_BATTERY) {
        Vibration.vibrate([0, 400, 200, 400]);
        void notifyDuty(
          'Battery low',
          `Your phone is at ${Math.round(level * 100)}%. Charge it now so welfare checks and SOS keep working.`,
        );
      }
      lastLevel = level;
      setBattery((b) => ({ ...b, level, low }));
    };
    const onState = (state: Battery.BatteryState) => {
      if (state === Battery.BatteryState.UNKNOWN) return;
      const charging = isCharging(state);
      const unpluggedNow =
        lastState !== null && isCharging(lastState) && state === Battery.BatteryState.UNPLUGGED;
      if (unpluggedNow) {
        Vibration.vibrate([0, 400, 200, 400]);
        void notifyDuty(
          'Charger unplugged',
          'Your phone is no longer charging. Plug it back in if you can.',
        );
      }
      lastState = state;
      setBattery((b) => ({ ...b, charging, unplugged: b.unplugged || unpluggedNow }));
    };

    void Battery.getBatteryLevelAsync()
      .then(onLevel)
      .catch(() => undefined);
    void Battery.getBatteryStateAsync()
      .then(onState)
      .catch(() => undefined);
    const levelSub = Battery.addBatteryLevelListener(({ batteryLevel }) => onLevel(batteryLevel));
    const stateSub = Battery.addBatteryStateListener(({ batteryState }) => onState(batteryState));
    return () => {
      levelSub.remove();
      stateSub.remove();
    };
  }, [onDuty]);

  useEffect(() => {
    if (!onDuty) {
      void clearReturnReminder();
      return;
    }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') void scheduleReturnReminder();
      if (s === 'active') void clearReturnReminder();
    });
    return () => sub.remove();
  }, [onDuty]);

  // The phone's alert permissions (re-read when the officer comes back from settings).
  const refreshSetup = useCallback(() => {
    void readAlertSetup()
      .then(setSetup)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!onDuty) return;
    refreshSetup();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshSetup());
    return () => sub.remove();
  }, [onDuty, refreshSetup]);

  // Open the duty screen once when a shift starts.
  useEffect(() => {
    if (!loaded || !shiftId || local.dutyOpenedFor === shiftId) return;
    void (async () => {
      await update((s) => ({ ...s, dutyOpenedFor: shiftId }));
      router.push('/on-duty');
    })();
  }, [loaded, shiftId, local.dutyOpenedFor, update]);

  const value: WelfareContextValue = {
    onDuty,
    shift,
    hasNextCheck: local.next !== null,
    due,
    confirm,
    queued: local.queue,
    answered: local.answered,
    battery,
    dismissUnplugged: () => setBattery((b) => ({ ...b, unplugged: false })),
    setup,
    refreshSetup,
  };
  return <WelfareContext value={value}>{children}</WelfareContext>;
}
