'use client';

import { useEffect, useState } from 'react';

// Live relative times for the welfare board. Server HTML shows the fallback
// (an absolute time); the browser takes over after mount, so the two never
// disagree during hydration.

function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

/** "in 12:04" until `at`; then "due 0:45 ago" in amber. */
export function Countdown({ at, fallback }: { at: string; fallback: string }) {
  const now = useNow(1000);
  if (now === null) return <span className="tabular-nums">{fallback}</span>;
  const diff = (Date.parse(at) - now) / 1000;
  if (diff >= 0) return <span className="tabular-nums">in {clock(diff)}</span>;
  return (
    <span className="text-amber-700 tabular-nums dark:text-amber-400">due {clock(-diff)} ago</span>
  );
}

/** "45 s ago", "4 min ago"; red past `staleMinutes`. */
export function Since({
  at,
  fallback,
  staleMinutes,
}: {
  at: string;
  fallback: string;
  staleMinutes?: number;
}) {
  const now = useNow(5000);
  if (now === null) return <span className="tabular-nums">{fallback}</span>;
  const seconds = Math.max(0, (now - Date.parse(at)) / 1000);
  const text =
    seconds < 60
      ? `${Math.floor(seconds)} s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)} min ago`
        : `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min ago`;
  const stale = staleMinutes !== undefined && seconds > staleMinutes * 60;
  return (
    <span className={`tabular-nums ${stale ? 'font-medium text-red-700 dark:text-red-400' : ''}`}>
      {text}
    </span>
  );
}
