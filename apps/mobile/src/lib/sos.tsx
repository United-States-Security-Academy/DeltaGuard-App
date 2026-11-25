import {
  EMERGENCY_NUMBER,
  mapLink,
  SOS_COUNTDOWN_SECONDS,
  SOS_LOCATION_INTERVAL_MS,
  type Tables,
} from '@deltaguard/shared';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Linking, Platform, Vibration } from 'react-native';

import { checkLocationPermission, getClockFix, requestLocationPermission } from './location';
import { secureStorage } from './secure-storage';
import { supabase } from './supabase';

// SOS on the phone.
//
//  hold 2 s -> 5 s countdown (cancel) -> trigger:
//    1. the alert gets an id here and is saved on the phone at once, so nothing
//       is lost if the app closes or there is no signal;
//    2. a quick position (last known, if recent) goes with the first attempt;
//       a precise one follows as soon as GPS has it;
//    3. raise_sos is retried every 5 s and whenever the network comes back,
//       until the server has it (the id makes retries safe);
//    4. no connection (or no answer within 10 s): the phone's SMS app opens
//       with a prefilled SOS to the supervisor (numbers cached while online).
//  While the alert is open and the app is in the foreground, the position is
//  sent every 30 s. Location is never collected in the background (CLAUDE.md).

export type SosAlert = Pick<
  Tables<'sos_alerts'>,
  | 'id'
  | 'status'
  | 'site_name'
  | 'latitude'
  | 'longitude'
  | 'accuracy_m'
  | 'location_at'
  | 'triggered_at'
  | 'acknowledged_by_name'
  | 'acknowledge_notes'
  | 'resolved_by_name'
  | 'resolution_notes'
  | 'escalation_level'
>;
const ALERT_COLUMNS =
  'id, status, site_name, latitude, longitude, accuracy_m, location_at, triggered_at, acknowledged_by_name, acknowledge_notes, resolved_by_name, resolution_notes, escalation_level';

export type SosContact = { name: string; phone: string; kind: string };

type Fix = { latitude: number; longitude: number; accuracyM: number | null; at: string };
type QueuedAction = {
  type: 'officer_called_emergency' | 'officer_called_supervisor' | 'officer_sms_fallback';
  at: string;
  data: Record<string, string>;
};
/** An SOS the server hasn't confirmed yet (kept on the phone until it has). */
type Pending = { id: string; triggeredAt: string; fix: Fix | null; actions: QueuedAction[] };

export type LocationState = 'locating' | 'found' | 'unavailable' | 'denied';

type SosContextValue = {
  /** Counting down (seconds left), or null. */
  countdown: number | null;
  startCountdown: () => void;
  cancelCountdown: () => void;
  /** The alert screen is showing. */
  screenOpen: boolean;
  openScreen: () => void;
  hideScreen: () => void;
  /** The alert as the server has it (null until it does). */
  alert: SosAlert | null;
  /** Raised on this phone but not yet received by the server. */
  sending: boolean;
  /** Couldn't reach the server for a while: use the phone and SMS. */
  offline: boolean;
  location: LocationState;
  lastFix: Fix | null;
  contacts: SosContact[];
  call: (number: string, kind: 'emergency' | 'supervisor') => void;
  textSupervisor: () => void;
  markSafe: (falseAlarm: boolean) => Promise<string | null>;
  dismiss: () => void;
};

const SosContext = createContext<SosContextValue | null>(null);

export function useSos(): SosContextValue {
  const value = useContext(SosContext);
  if (!value) throw new Error('useSos must be used inside SosProvider');
  return value;
}

const pendingKey = (userId: string) => `sos.pending.${userId}`;
const contactsKey = (userId: string) => `sos.contacts.${userId}`;

const RETRY_MS = 5_000;
/** No answer from the server this long after the trigger: offer / open SMS. */
const SMS_FALLBACK_AFTER_MS = 10_000;

const isOpen = (a: SosAlert | null) => a?.status === 'active' || a?.status === 'acknowledged';

async function quickFix(): Promise<Fix | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 120_000,
      requiredAccuracy: 300,
    });
    if (!last) return null;
    return {
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
      accuracyM: last.coords.accuracy ?? null,
      at: new Date(last.timestamp).toISOString(),
    };
  } catch {
    return null;
  }
}

async function preciseFix(): Promise<Fix | null> {
  const result = await getClockFix(); // Accuracy.Highest, 30 s timeout
  if (!result.ok) return null;
  return {
    latitude: result.fix.latitude,
    longitude: result.fix.longitude,
    accuracyM: result.fix.accuracyM,
    at: new Date().toISOString(),
  };
}

function smsUrl(phone: string, body: string): string {
  // iOS separates the body with "&", Android with "?".
  return `sms:${phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export function SosProvider({
  userId,
  fullName,
  children,
}: {
  userId: string;
  fullName: string | null;
  children: ReactNode;
}) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const [screenOpen, setScreenOpen] = useState(false);
  const [alert, setAlert] = useState<SosAlert | null>(null);
  const [pending, setPendingState] = useState<Pending | null>(null);
  const [offline, setOffline] = useState(false);
  const [location, setLocation] = useState<LocationState>('locating');
  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const [contacts, setContacts] = useState<SosContact[]>([]);

  const pendingRef = useRef<Pending | null>(null);
  const alertRef = useRef<SosAlert | null>(null);
  const contactsRef = useRef<SosContact[]>([]);
  const sendingNow = useRef(false);
  const smsOpened = useRef(false);
  const lastFixRef = useRef<Fix | null>(null);
  useEffect(() => {
    alertRef.current = alert;
  }, [alert]);
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  const setPending = useCallback(
    (next: Pending | null) => {
      pendingRef.current = next;
      setPendingState(next);
      const key = pendingKey(userId);
      void (
        next ? secureStorage.setItem(key, JSON.stringify(next)) : secureStorage.removeItem(key)
      ).catch(() => undefined);
    },
    [userId],
  );

  // ---------------------------------------------------------------------------
  // Start-up: contacts (cached for offline), an unsent SOS, an open alert.
  // ---------------------------------------------------------------------------

  const refreshContacts = useCallback(async () => {
    const { data, error } = await supabase.rpc('sos_contacts_for_me');
    if (error || !data) return;
    const list = data
      .filter((c) => c.phone)
      .map((c) => ({ name: c.name, phone: c.phone!, kind: c.kind }));
    setContacts(list);
    await secureStorage.setItem(contactsKey(userId), JSON.stringify(list)).catch(() => undefined);
  }, [userId]);

  const refreshAlert = useCallback(async () => {
    const id = alertRef.current?.id;
    const query = supabase.from('sos_alerts').select(ALERT_COLUMNS).eq('officer_id', userId);
    const { data } = id
      ? await query.eq('id', id).maybeSingle()
      : await query
          .in('status', ['active', 'acknowledged'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
    if (data) {
      setAlert(data);
      if (!id && isOpen(data)) setScreenOpen(true);
    }
  }, [userId]);

  useEffect(() => {
    void (async () => {
      const cached = await secureStorage.getItem(contactsKey(userId)).catch(() => null);
      if (cached) setContacts(JSON.parse(cached) as SosContact[]);
      const saved = await secureStorage.getItem(pendingKey(userId)).catch(() => null);
      if (saved) {
        // Raised earlier but never confirmed (app closed, no signal): keep going.
        pendingRef.current = JSON.parse(saved) as Pending;
        setPendingState(pendingRef.current);
        setScreenOpen(true);
      }
      void refreshContacts();
      void refreshAlert();
    })();
  }, [userId, refreshContacts, refreshAlert]);

  // ---------------------------------------------------------------------------
  // Sending the alert (retried until the server has it)
  // ---------------------------------------------------------------------------

  const logAction = useCallback(
    (action: QueuedAction) => {
      const current = alertRef.current;
      if (current) {
        void supabase.rpc('sos_log_officer_action', {
          p_alert_id: current.id,
          p_type: action.type,
          p_at: action.at,
          p_data: action.data,
        });
        return;
      }
      const p = pendingRef.current;
      if (p) setPending({ ...p, actions: [...p.actions, action] });
    },
    [setPending],
  );

  const sendPending = useCallback(async () => {
    const p = pendingRef.current;
    if (!p || sendingNow.current) return;
    sendingNow.current = true;
    try {
      const { data, error } = await supabase.rpc('raise_sos', {
        p_id: p.id,
        p_latitude: p.fix?.latitude,
        p_longitude: p.fix?.longitude,
        p_accuracy_m: p.fix?.accuracyM ?? undefined,
        p_triggered_at: p.triggeredAt,
      });
      if (error) throw error;
      setOffline(false);
      setAlert({
        id: data.id,
        status: data.status,
        site_name: data.site_name,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy_m: data.accuracy_m,
        location_at: data.location_at,
        triggered_at: data.triggered_at,
        acknowledged_by_name: data.acknowledged_by_name,
        acknowledge_notes: data.acknowledge_notes,
        resolved_by_name: data.resolved_by_name,
        resolution_notes: data.resolution_notes,
        escalation_level: data.escalation_level,
      });
      alertRef.current = { ...data };
      // Anything done before the server had it (calls, the SMS fallback).
      for (const action of p.actions) {
        void supabase.rpc('sos_log_officer_action', {
          p_alert_id: data.id,
          p_type: action.type,
          p_at: action.at,
          p_data: action.data,
        });
      }
      // A precise fix that arrived after this attempt started.
      const latest = pendingRef.current?.fix;
      if (latest && latest !== p.fix) {
        void supabase.rpc('sos_location_update', {
          p_alert_id: data.id,
          p_latitude: latest.latitude,
          p_longitude: latest.longitude,
          p_accuracy_m: latest.accuracyM ?? undefined,
          p_recorded_at: latest.at,
        });
      }
      setPending(null);
    } catch {
      setOffline(true);
    } finally {
      sendingNow.current = false;
    }
  }, [setPending]);

  // Retry every few seconds, and the moment the network comes back.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void sendPending(), RETRY_MS);
    const network = Network.addNetworkStateListener((s) => {
      if (s.isConnected) void sendPending();
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sendPending();
    });
    return () => {
      clearInterval(timer);
      network.remove();
      app.remove();
    };
  }, [pending, sendPending]);

  const textSupervisor = useCallback(() => {
    const p = pendingRef.current;
    const fix = p?.fix ?? lastFixRef.current;
    const to = contactsRef.current[0]?.phone ?? '';
    const body =
      `SOS from ${fullName ?? 'a Deltacon Guard officer'}. I need help.` +
      (fix
        ? ` Location: ${mapLink(fix.latitude.toFixed(6), fix.longitude.toFixed(6))}` +
          (fix.accuracyM ? ` (within ${Math.round(fix.accuracyM)} m)` : '')
        : ' Location unknown.') +
      ' (Sent by text: the Deltacon Guard app has no connection.)';
    smsOpened.current = true;
    void Linking.openURL(smsUrl(to, body)).catch(() => undefined);
    logAction({ type: 'officer_sms_fallback', at: new Date().toISOString(), data: { to } });
  }, [fullName, logAction]);

  // Offline at the trigger, or no answer within 10 s: open the SMS app once.
  useEffect(() => {
    if (!pending || smsOpened.current) return;
    const elapsed = Date.now() - Date.parse(pending.triggeredAt);
    const timer = setTimeout(
      () => {
        if (pendingRef.current && !smsOpened.current) {
          setOffline(true);
          textSupervisor();
        }
      },
      Math.max(0, SMS_FALLBACK_AFTER_MS - elapsed),
    );
    return () => clearTimeout(timer);
  }, [pending, textSupervisor]);

  // ---------------------------------------------------------------------------
  // Trigger
  // ---------------------------------------------------------------------------

  const recordFix = useCallback((fix: Fix) => {
    lastFixRef.current = fix;
    setLastFix(fix);
    setLocation('found');
  }, []);

  const trigger = useCallback(async () => {
    Vibration.vibrate([0, 400, 150, 400]);
    smsOpened.current = false;
    const p: Pending = {
      id: Crypto.randomUUID(),
      triggeredAt: new Date().toISOString(),
      fix: null,
      actions: [],
    };
    setPending(p);
    setScreenOpen(true);
    setLocation('locating');

    const network = await Network.getNetworkStateAsync().catch(() => null);
    if (network?.isConnected === false || network?.isInternetReachable === false) {
      setOffline(true);
    }

    let permission = await checkLocationPermission();
    if (permission === 'ask') {
      permission = (await requestLocationPermission()) === 'granted' ? 'granted' : 'blocked';
    }
    if (permission !== 'granted') {
      setLocation('denied');
      void sendPending();
      return;
    }

    // Fast first: a recent last-known position goes with the first attempt.
    const quick = await quickFix();
    if (quick && pendingRef.current?.id === p.id) {
      recordFix(quick);
      setPending({ ...pendingRef.current, fix: quick });
    }
    void sendPending();

    // Then a precise one: into the queue if not sent yet, else as an update.
    const precise = await preciseFix();
    if (!precise) {
      if (!quick) setLocation('unavailable');
      return;
    }
    recordFix(precise);
    if (pendingRef.current?.id === p.id) {
      setPending({ ...pendingRef.current, fix: precise });
      void sendPending();
    } else if (alertRef.current?.id === p.id) {
      void supabase.rpc('sos_location_update', {
        p_alert_id: p.id,
        p_latitude: precise.latitude,
        p_longitude: precise.longitude,
        p_accuracy_m: precise.accuracyM ?? undefined,
        p_recorded_at: precise.at,
      });
    }
  }, [recordFix, sendPending, setPending]);

  // Countdown: 5, 4, ... 1, then send. State only changes in the timer.
  useEffect(() => {
    if (countdown === null) return;
    Vibration.vibrate(60);
    const timer = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(null);
        void trigger();
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, trigger]);

  const startCountdown = useCallback(() => {
    if (isOpen(alertRef.current) || pendingRef.current) {
      setScreenOpen(true); // already raised: just show it
      return;
    }
    setCountdown(SOS_COUNTDOWN_SECONDS);
  }, []);

  // ---------------------------------------------------------------------------
  // While the alert is open
  // ---------------------------------------------------------------------------

  const open = isOpen(alert);
  const alertId = alert?.id ?? null;

  // Live status (acknowledged / resolved) from Realtime, and on return to the app.
  useEffect(() => {
    if (!alertId) return;
    const channel = supabase
      .channel(`sos:${alertId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: `id=eq.${alertId}` },
        () => void refreshAlert(),
      )
      .subscribe();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshAlert();
    });
    return () => {
      void supabase.removeChannel(channel);
      app.remove();
    };
  }, [alertId, refreshAlert]);

  // Position every 30 s, only while the app is in the foreground.
  useEffect(() => {
    if (!open || !alertId) return;
    let busy = false;
    const send = async () => {
      if (busy || AppState.currentState !== 'active') return;
      if ((await checkLocationPermission()) !== 'granted') return;
      busy = true;
      try {
        const fix = await preciseFix();
        if (!fix) return;
        recordFix(fix);
        await supabase.rpc('sos_location_update', {
          p_alert_id: alertId,
          p_latitude: fix.latitude,
          p_longitude: fix.longitude,
          p_accuracy_m: fix.accuracyM ?? undefined,
          p_recorded_at: fix.at,
        });
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void send(), SOS_LOCATION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [open, alertId, recordFix]);

  // ---------------------------------------------------------------------------

  const call = useCallback(
    (number: string, kind: 'emergency' | 'supervisor') => {
      void Linking.openURL(`tel:${number}`).catch(() => undefined);
      logAction({
        type: kind === 'emergency' ? 'officer_called_emergency' : 'officer_called_supervisor',
        at: new Date().toISOString(),
        data: { number },
      });
    },
    [logAction],
  );

  const markSafe = useCallback(
    async (falseAlarm: boolean): Promise<string | null> => {
      const current = alertRef.current;
      if (!current) {
        // Never reached the server: just stop trying.
        setPending(null);
        setScreenOpen(false);
        return null;
      }
      const { data, error } = await supabase.rpc('sos_mark_safe', {
        p_alert_id: current.id,
        p_false_alarm: falseAlarm,
      });
      if (error) return error.message;
      setAlert({ ...current, status: data.status, resolution_notes: data.resolution_notes });
      return null;
    },
    [setPending],
  );

  const dismiss = useCallback(() => {
    if (isOpen(alertRef.current) || pendingRef.current) {
      setScreenOpen(false); // hide only; the SOS button reopens it
      return;
    }
    setAlert(null);
    setLastFix(null);
    setOffline(false);
    setScreenOpen(false);
  }, []);

  const value = useMemo<SosContextValue>(
    () => ({
      countdown,
      startCountdown,
      cancelCountdown: () => setCountdown(null),
      screenOpen,
      openScreen: () => setScreenOpen(true),
      hideScreen: () => setScreenOpen(false),
      alert,
      sending: pending !== null,
      offline,
      location,
      lastFix,
      contacts,
      call,
      textSupervisor,
      markSafe,
      dismiss,
    }),
    [
      countdown,
      startCountdown,
      screenOpen,
      alert,
      pending,
      offline,
      location,
      lastFix,
      contacts,
      call,
      textSupervisor,
      markSafe,
      dismiss,
    ],
  );

  return <SosContext.Provider value={value}>{children}</SosContext.Provider>;
}

export { EMERGENCY_NUMBER };
