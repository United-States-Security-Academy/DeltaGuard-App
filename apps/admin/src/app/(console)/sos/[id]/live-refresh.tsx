'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Re-renders the alert page when the alert or its log changes (Realtime, RLS: staff). */
export function SosLiveRefresh({ alertId }: { alertId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => startTransition(() => router.refresh()), 500);
    };
    void (async () => {
      await supabase.realtime.setAuth();
      if (disposed) return;
      channel = supabase
        .channel(`sos-page:${alertId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'sos_alerts', filter: `id=eq.${alertId}` },
          refresh,
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sos_events',
            filter: `alert_id=eq.${alertId}`,
          },
          refresh,
        )
        .subscribe();
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [alertId, router]);
  return null;
}
