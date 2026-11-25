'use client';

import { mapLink, type Tables } from '@deltaguard/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

import { SosActions } from './sos-actions';
import { SosMap } from './sos-map';

type Alert = Tables<'sos_alerts'>;

/**
 * Mounted on every console page. An active (unacknowledged) SOS covers the whole
 * screen with an alarm sound until someone acknowledges it; an acknowledged one
 * stays as a red bar until it is resolved. Live via Realtime (RLS: staff).
 */
export function SosWatcher() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('sos_alerts')
      .select('*')
      .in('status', ['active', 'acknowledged'])
      .order('created_at');
    if (data) setAlerts(data);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    void (async () => {
      await load();
      await supabase.realtime.setAuth();
      if (disposed) return;
      channel = supabase
        .channel('console-sos')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'sos_alerts' },
          () => void load(),
        )
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') void load();
        });
    })();
    // Belt and braces if the socket drops: check every 20 s.
    const poll = setInterval(() => void load(), 20_000);
    return () => {
      disposed = true;
      clearInterval(poll);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  const active = alerts.filter((a) => a.status === 'active');
  const acknowledged = alerts.filter((a) => a.status === 'acknowledged');
  // On an alert's own page, that page shows it.
  const onPage = (a: Alert) => pathname === `/sos/${a.id}`;
  const overlay = active.filter((a) => !onPage(a));

  useAlarm(active.length > 0);
  useDesktopNotification(active);

  return (
    <>
      {acknowledged.filter((a) => !onPage(a)).length > 0 && overlay.length === 0 ? (
        <div className="fixed inset-x-0 top-0 z-[900] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-red-700 px-4 py-2 text-sm text-white shadow-lg">
          {acknowledged
            .filter((a) => !onPage(a))
            .map((a) => (
              <Link key={a.id} href={`/sos/${a.id}`} className="font-medium hover:underline">
                SOS open: {a.officer_name}
                {a.site_name ? ` at ${a.site_name}` : ''} · acknowledged by{' '}
                {a.acknowledged_by_name ?? 'staff'} · resolve →
              </Link>
            ))}
        </div>
      ) : null}
      {overlay.length > 0 ? <AlarmOverlay alerts={overlay} onChanged={() => void load()} /> : null}
    </>
  );
}

function AlarmOverlay({ alerts, onChanged }: { alerts: Alert[]; onChanged: () => void }) {
  const [index, setIndex] = useState(0);
  const alert = alerts[Math.min(index, alerts.length - 1)]!;
  const sound = useAlarmState();
  const minutes = useMinutesSince(alert.triggered_at);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sos-title"
      className="fixed inset-0 z-[1000] overflow-y-auto bg-red-700 text-white"
    >
      <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-5 p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-bold tracking-[0.3em] uppercase">
            <span className="size-3 animate-ping rounded-full bg-white" /> SOS
            {alerts.length > 1 ? ` · ${alerts.length} active` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {sound === 'blocked' ? (
              <button
                type="button"
                onClick={() => void resumeAlarm()}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-bold text-red-700"
              >
                Turn on alarm sound
              </button>
            ) : null}
            {alerts.length > 1
              ? alerts.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-pressed={a.id === alert.id}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      a.id === alert.id ? 'bg-white text-red-700' : 'bg-white/15 hover:bg-white/25'
                    }`}
                  >
                    {a.officer_name}
                  </button>
                ))
              : null}
          </div>
        </div>

        <div>
          <h1 id="sos-title" className="text-4xl font-black sm:text-5xl">
            {alert.officer_name} needs help
          </h1>
          <p className="mt-2 text-lg text-white/90">
            {alert.site_name ?? 'Site unknown'} · raised{' '}
            {new Date(alert.triggered_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            ({minutes < 1 ? 'just now' : `${minutes} min ago`}) · nobody has acknowledged yet
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-2">
            <SosMap alertId={alert.id} className="h-[22rem] ring-4 ring-white/20" />
            <p className="text-sm text-white/80">
              {alert.latitude !== null && alert.longitude !== null ? (
                <>
                  Last position
                  {alert.accuracy_m ? ` within ${Math.round(Number(alert.accuracy_m))} m` : ''}
                  {alert.location_at
                    ? ` at ${new Date(alert.location_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                    : ''}
                  {' · '}
                  <a
                    href={mapLink(alert.latitude, alert.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Open in Google Maps
                  </a>
                </>
              ) : (
                'No position yet.'
              )}
            </p>
          </div>

          <div className="flex flex-col gap-4 rounded-3xl bg-black/20 p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-white/70">Officer phone</dt>
              <dd>
                {alert.officer_phone ? (
                  <a href={`tel:${alert.officer_phone}`} className="font-semibold underline">
                    {alert.officer_phone}
                  </a>
                ) : (
                  'Not on file'
                )}
              </dd>
              <dt className="text-white/70">Alerted</dt>
              <dd>
                {alert.escalation_level <= 1
                  ? 'Supervisors and admins (push + SMS)'
                  : `Escalation round ${alert.escalation_level}`}
              </dd>
              <dt className="text-white/70">Next escalation</dt>
              <dd>
                {alert.next_escalation_at
                  ? new Date(alert.next_escalation_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : '—'}
              </dd>
            </dl>
            <SosActions alertId={alert.id} status={alert.status} tone="alarm" onDone={onChanged} />
            <Link href={`/sos/${alert.id}`} className="text-sm text-white/80 underline">
              Open the full alert page (log of every notification)
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function useMinutesSince(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return Math.floor((now - Date.parse(iso)) / 60_000);
}

// ---------------------------------------------------------------------------
// Alarm sound (Web Audio: no audio file needed). Browsers only allow sound
// after the user has interacted with the page; if that hasn't happened, the
// overlay shows "Turn on alarm sound".
// ---------------------------------------------------------------------------

let audio: AudioContext | null = null;
const listeners = new Set<() => void>();

function audioState(): 'on' | 'blocked' {
  return audio?.state === 'running' ? 'on' : 'blocked';
}

async function resumeAlarm() {
  audio ??= new AudioContext();
  await audio.resume().catch(() => undefined);
  listeners.forEach((l) => l());
}

function useAlarmState() {
  const [state, setState] = useState(audioState);
  useEffect(() => {
    const update = () => setState(audioState());
    listeners.add(update);
    // Any click or key press on the page unlocks sound.
    const unlock = () => void resumeAlarm();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      listeners.delete(update);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  return state;
}

/** Two-tone siren every 1.6 s while `on`. */
function useAlarm(on: boolean) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!on) return;
    audio ??= new AudioContext();
    void audio.resume().catch(() => undefined);
    const beep = () => {
      const ctx = audio;
      if (!ctx || ctx.state !== 'running') return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(660, t + 0.35);
      osc.frequency.setValueAtTime(880, t + 0.7);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.setValueAtTime(0.25, t + 1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.1);
    };
    beep();
    timer.current = setInterval(beep, 1600);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [on]);
}

/** A system notification when the console tab is in the background. */
function useDesktopNotification(active: Alert[]) {
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') void Notification.requestPermission();
    if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    for (const a of active) {
      if (shown.current.has(a.id)) continue;
      shown.current.add(a.id);
      const n = new Notification(`SOS: ${a.officer_name}`, {
        body: `${a.site_name ?? 'Site unknown'}. Open the console to respond.`,
        requireInteraction: true,
        tag: `sos-${a.id}`,
      });
      n.onclick = () => window.focus();
    }
  }, [active]);
}
