'use client';

import { useEffect, useRef, useState } from 'react';

// Console alarm sound (Web Audio: no audio file needed), shared by the SOS and
// welfare watchers. One siren plays while ANY watcher asks for it, so two open
// alerts never play two sirens. Browsers only allow sound after the user has
// interacted with the page; until then useAlarmState() reports 'blocked' and the
// overlay offers "Turn on alarm sound".

let audio: AudioContext | null = null;
const listeners = new Set<() => void>();
let wanted = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function audioState(): 'on' | 'blocked' {
  return audio?.state === 'running' ? 'on' : 'blocked';
}

export async function resumeAlarm() {
  audio ??= new AudioContext();
  await audio.resume().catch(() => undefined);
  listeners.forEach((l) => l());
}

export function useAlarmState() {
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

/** Two-tone siren. */
function beep() {
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
}

/** Siren every 1.6 s while `on` (for any caller). */
export function useAlarm(on: boolean) {
  useEffect(() => {
    if (!on) return;
    audio ??= new AudioContext();
    void audio.resume().catch(() => undefined);
    wanted += 1;
    if (wanted === 1) {
      beep();
      timer = setInterval(beep, 1600);
    }
    return () => {
      wanted -= 1;
      if (wanted === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [on]);
}

/** Whole minutes since `iso`, refreshed every 15 s. */
export function useMinutesSince(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return Math.floor((now - Date.parse(iso)) / 60_000);
}

/** A system notification per key while the console tab is in the background. */
export function useDesktopNotifications(items: { key: string; title: string; body: string }[]) {
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') void Notification.requestPermission();
    if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    for (const item of items) {
      if (shown.current.has(item.key)) continue;
      shown.current.add(item.key);
      const n = new Notification(item.title, {
        body: item.body,
        requireInteraction: true,
        tag: item.key,
      });
      n.onclick = () => window.focus();
    }
  }, [items]);
}
