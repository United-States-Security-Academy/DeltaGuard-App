'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Re-render anyway this often, so "late" appears as start times pass. */
const TICK_MS = 60_000;
/** Bursts of changes (e.g. the missed-shift job) become one refresh. */
const DEBOUNCE_MS = 750;

/**
 * Keeps a server-rendered page live: re-renders it (router.refresh) whenever a
 * shift or attendance event changes, via Supabase Realtime. Realtime applies
 * RLS with the signed-in user's token, so only rows they may read trigger it.
 * The page itself always re-reads the data on the server.
 */
export function LiveRefresh({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => startTransition(() => router.refresh()), DEBOUNCE_MS);
    };

    (async () => {
      // Use the user's own access token so RLS lets staff rows through.
      await supabase.realtime.setAuth();
      if (disposed) return;
      channel = supabase
        .channel('schedule-today')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, refresh)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'attendance_events' },
          refresh,
        )
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') {
            setStatus('live');
            refresh(); // catch anything that changed while connecting
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            setStatus('offline');
          }
        });
    })().catch(() => setStatus('offline'));

    const tick = setInterval(refresh, TICK_MS);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(tick);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router]);

  const dot =
    status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500';
  return (
    <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
      <span
        className={`inline-block h-2 w-2 rounded-full ${dot} ${status === 'live' ? 'animate-pulse' : ''}`}
      />
      {status === 'live'
        ? 'Live'
        : status === 'connecting'
          ? 'Connecting…'
          : 'Live updates unavailable, refreshing every minute'}
      <span>· updated {renderedAt}</span>
    </p>
  );
}
