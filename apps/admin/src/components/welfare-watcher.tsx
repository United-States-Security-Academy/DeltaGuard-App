'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

import {
  resumeAlarm,
  useAlarm,
  useAlarmState,
  useDesktopNotifications,
  useMinutesSince,
} from './alarm';
import { WelfareActions } from './welfare-actions';

type Escalated = {
  id: string;
  officerId: string;
  officerName: string;
  officerPhone: string | null;
  siteName: string;
  since: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  respondedAt: string | null;
  callsMade: number;
  heartbeat: { at: string; battery: number | null; appState: string } | null;
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Mounted on every console page, next to the SOS watcher. An escalated welfare
 * check nobody has acknowledged covers the screen with the alarm sound; once
 * acknowledged it stays as a bar until resolved. Live via Realtime; RLS limits
 * supervisors to their sites and to checks they were alerted about.
 */
export function WelfareWatcher() {
  const pathname = usePathname();
  const [checks, setChecks] = useState<Escalated[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('welfare_checks')
      .select(
        `id, officer_id, scheduled_at, prompted_at, acknowledged_at, responded_at, calls_made,
         officer:profiles!welfare_checks_officer_id_fkey(full_name, phone),
         acknowledger:profiles!welfare_checks_acknowledged_by_fkey(full_name),
         sites(name)`,
      )
      .eq('status', 'escalated')
      .order('scheduled_at');
    if (!data) return;
    const officerIds = [...new Set(data.map((c) => c.officer_id))];
    const beats = officerIds.length
      ? ((
          await supabase
            .from('device_heartbeats')
            .select('officer_id, last_seen_at, battery_level, app_state')
            .in('officer_id', officerIds)
        ).data ?? [])
      : [];
    setChecks(
      data.map((c) => {
        const beat = beats.find((b) => b.officer_id === c.officer_id);
        return {
          id: c.id,
          officerId: c.officer_id,
          officerName: c.officer?.full_name ?? 'An officer',
          officerPhone: c.officer?.phone ?? null,
          siteName: c.sites?.name ?? 'Unknown site',
          since: c.prompted_at ?? c.scheduled_at,
          acknowledgedAt: c.acknowledged_at,
          acknowledgedBy: c.acknowledger?.full_name ?? null,
          respondedAt: c.responded_at,
          callsMade: c.calls_made,
          heartbeat: beat
            ? { at: beat.last_seen_at, battery: beat.battery_level, appState: beat.app_state }
            : null,
        };
      }),
    );
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
        .channel('console-welfare')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'welfare_checks' },
          () => void load(),
        )
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') void load();
        });
    })();
    // If the socket drops: check every 20 s.
    const poll = setInterval(() => void load(), 20_000);
    return () => {
      disposed = true;
      clearInterval(poll);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  const onPage = (c: Escalated) => pathname === `/welfare/checks/${c.id}`;
  const unacknowledged = checks.filter((c) => !c.acknowledgedAt);
  const overlay = unacknowledged.filter((c) => !onPage(c));
  const taken = checks.filter((c) => c.acknowledgedAt && !onPage(c));

  useAlarm(unacknowledged.length > 0);
  useDesktopNotifications(
    unacknowledged.map((c) => ({
      key: `welfare-${c.id}`,
      title: `Welfare check missed: ${c.officerName}`,
      body: `${c.siteName}. No answer since ${time(c.since)}. Open the console to respond.`,
    })),
  );

  return (
    <>
      {taken.length > 0 && overlay.length === 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-[890] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-orange-700 px-4 py-2 text-sm text-white shadow-lg">
          {taken.map((c) => (
            <Link
              key={c.id}
              href={`/welfare/checks/${c.id}`}
              className="font-medium hover:underline"
            >
              Welfare alert open: {c.officerName} at {c.siteName} · acknowledged by{' '}
              {c.acknowledgedBy ?? 'staff'} · resolve →
            </Link>
          ))}
        </div>
      ) : null}
      {overlay.length > 0 ? <AlarmOverlay checks={overlay} onChanged={() => void load()} /> : null}
    </>
  );
}

function AlarmOverlay({ checks, onChanged }: { checks: Escalated[]; onChanged: () => void }) {
  const [index, setIndex] = useState(0);
  const check = checks[Math.min(index, checks.length - 1)]!;
  const sound = useAlarmState();
  const minutes = useMinutesSince(check.since);
  const sinceBeat = useMinutesSince(check.heartbeat?.at ?? check.since);
  const beatMinutes = check.heartbeat ? sinceBeat : null;

  return (
    // Below the SOS overlay (z-1000): an SOS is the more urgent of the two.
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="welfare-alarm-title"
      className="fixed inset-0 z-[990] overflow-y-auto bg-orange-700 text-white"
    >
      <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-6 p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-bold tracking-[0.3em] uppercase">
            <span className="size-3 animate-ping rounded-full bg-white" /> Welfare alert
            {checks.length > 1 ? ` · ${checks.length} open` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {sound === 'blocked' ? (
              <button
                type="button"
                onClick={() => void resumeAlarm()}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-bold text-orange-800"
              >
                Turn on alarm sound
              </button>
            ) : null}
            {checks.length > 1
              ? checks.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-pressed={c.id === check.id}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      c.id === check.id
                        ? 'bg-white text-orange-800'
                        : 'bg-white/15 hover:bg-white/25'
                    }`}
                  >
                    {c.officerName}
                  </button>
                ))
              : null}
          </div>
        </div>

        <div>
          <h1 id="welfare-alarm-title" className="text-4xl font-black sm:text-5xl">
            {check.officerName} missed a welfare check
          </h1>
          <p className="mt-2 text-lg text-white/90">
            {check.siteName} · no answer since {time(check.since)} (
            {minutes < 1 ? 'just now' : `${minutes} min ago`})
            {check.callsMade > 0 ? ` · ${check.callsMade} automated call(s) unanswered` : ''}
          </p>
          {check.respondedAt ? (
            <p className="mt-2 inline-block rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">
              The officer has since answered (at {time(check.respondedAt)}). Confirm and resolve.
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 sm:grid-cols-[1fr_1.4fr]">
          <dl className="grid h-fit grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-3xl bg-black/20 p-5 text-sm">
            <dt className="text-white/70">Phone last seen</dt>
            <dd>
              {check.heartbeat && beatMinutes !== null
                ? `${beatMinutes < 1 ? 'under a minute' : `${beatMinutes} min`} ago (app ${check.heartbeat.appState})`
                : 'No heartbeat received'}
            </dd>
            <dt className="text-white/70">Battery</dt>
            <dd>
              {check.heartbeat?.battery !== null && check.heartbeat?.battery !== undefined
                ? `${check.heartbeat.battery}%`
                : 'Unknown'}
            </dd>
            <dt className="text-white/70">Officer phone</dt>
            <dd>{check.officerPhone ?? 'Not on file'}</dd>
          </dl>
          <div className="flex flex-col gap-4 rounded-3xl bg-black/20 p-5">
            <WelfareActions
              checkId={check.id}
              status="escalated"
              acknowledged={false}
              officerPhone={check.officerPhone}
              tone="alarm"
              onDone={onChanged}
            />
            <Link href={`/welfare/checks/${check.id}`} className="text-sm text-white/80 underline">
              Open the check (full log of prompts, calls and messages)
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
