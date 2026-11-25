import { mapLink, SOS_EVENT_LABELS, SOS_STATUS_LABELS } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { SosActions } from '@/components/sos-actions';
import { SosMap } from '@/components/sos-map';
import { Badge, Card, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { formatWhen } from '../../incidents/data';
import { getTimeZone } from '../../schedule/data';
import { SOS_TONE } from '../tone';
import { SosLiveRefresh } from './live-refresh';

export default function SosAlertPage({ params }: PageProps<'/sos/[id]'>) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/sos" className="text-sm text-muted hover:underline">
        ← SOS alerts
      </Link>
      <Suspense fallback={<p className="text-muted">Loading the alert…</p>}>
        <AlertDetail params={params} />
      </Suspense>
    </div>
  );
}

/** Plain-language details for a log entry's data. */
function describe(type: string, data: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (typeof data.round === 'number' && type !== 'notified') parts.push(`round ${data.round}`);
  if (typeof data.contact === 'string') parts.push(data.contact);
  if (Array.isArray(data.push_user_ids)) parts.push(`${data.push_user_ids.length} pushed`);
  if (typeof data.sms_queued === 'number') parts.push(`${data.sms_queued} SMS queued`);
  if (typeof data.without_sms_number === 'number' && data.without_sms_number > 0) {
    parts.push(`${data.without_sms_number} without a mobile number on file`);
  }
  if (typeof data.to === 'string' && data.to) parts.push(`to ${data.to}`);
  if (typeof data.phone === 'string') parts.push(data.phone);
  if (typeof data.number === 'string') parts.push(data.number);
  if (typeof data.error === 'string' && data.error) parts.push(data.error);
  if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
    parts.push(`at ${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`);
  }
  if (typeof data.at === 'string')
    parts.push(`on the phone at ${new Date(data.at).toLocaleTimeString()}`);
  return parts.length ? parts.join(' · ') : null;
}

async function AlertDetail({ params }: { params: PageProps<'/sos/[id]'>['params'] }) {
  await requireStaff();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);

  const [alert, events] = await Promise.all([
    supabase.from('sos_alerts').select('*').eq('id', id.data).maybeSingle(),
    supabase.from('sos_events').select('*').eq('alert_id', id.data).order('created_at').order('id'),
  ]);
  if (alert.error) return <ErrorText>Could not load the alert: {alert.error.message}</ErrorText>;
  if (!alert.data) notFound();
  if (events.error) return <ErrorText>Could not load the log: {events.error.message}</ErrorText>;
  const a = alert.data;
  const when = (iso: string) => formatWhen(iso, timeZone);

  return (
    <>
      <SosLiveRefresh alertId={a.id} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">SOS: {a.officer_name}</h1>
          <p className="mt-1 text-muted">
            {a.site_name ?? 'Site unknown'} · raised {when(a.triggered_at)}
            {a.created_at !== a.triggered_at ? ` (received ${when(a.created_at)})` : ''}
          </p>
        </div>
        <Badge tone={SOS_TONE[a.status]}>{SOS_STATUS_LABELS[a.status]}</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Location">
          <div className="flex flex-col gap-2">
            <SosMap alertId={a.id} className="h-96" />
            {a.latitude !== null && a.longitude !== null ? (
              <p className="text-sm text-muted">
                Last position{a.accuracy_m ? ` within ${Math.round(a.accuracy_m)} m` : ''}
                {a.location_at ? ` at ${when(a.location_at)}` : ''} ·{' '}
                <a
                  href={mapLink(a.latitude, a.longitude)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-ink underline"
                >
                  Open in Google Maps
                </a>
              </p>
            ) : null}
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Officer phone</dt>
              <dd>
                {a.officer_phone ? (
                  <a href={`tel:${a.officer_phone}`} className="underline">
                    {a.officer_phone}
                  </a>
                ) : (
                  'Not on file'
                )}
              </dd>
              <dt className="text-muted">Acknowledged</dt>
              <dd>
                {a.acknowledged_at
                  ? `${when(a.acknowledged_at)} by ${a.acknowledged_by_name ?? 'staff'}`
                  : 'Not yet'}
                {a.acknowledge_notes ? (
                  <span className="block text-muted">{a.acknowledge_notes}</span>
                ) : null}
              </dd>
              <dt className="text-muted">Closed</dt>
              <dd>
                {a.resolved_at
                  ? `${when(a.resolved_at)} by ${a.resolved_by_name ?? 'staff'}`
                  : 'Open'}
                {a.resolution_notes ? (
                  <span className="block text-muted">{a.resolution_notes}</span>
                ) : null}
              </dd>
              <dt className="text-muted">Notification rounds</dt>
              <dd>{a.escalation_level}</dd>
            </dl>
          </Card>
          {a.status === 'active' || a.status === 'acknowledged' ? (
            <Card title="Respond">
              <SosActions alertId={a.id} status={a.status} />
            </Card>
          ) : null}
        </div>
      </div>

      <Card title="Log">
        <ol className="flex flex-col">
          {events.data.map((e) => {
            const details = describe(e.type, (e.data ?? {}) as Record<string, unknown>);
            const bad = e.type === 'sms_failed' || e.type === 'sms_skipped';
            return (
              <li
                key={e.id}
                className="flex gap-4 border-t border-line py-2.5 text-sm first:border-t-0"
              >
                <time dateTime={e.created_at} className="w-40 shrink-0 text-muted tabular-nums">
                  {when(e.created_at)}
                </time>
                <div className="min-w-0">
                  <p className={`font-medium ${bad ? 'text-red-700 dark:text-red-400' : ''}`}>
                    {SOS_EVENT_LABELS[e.type] ?? e.type}
                    {e.actor_name ? (
                      <span className="font-normal text-muted"> · {e.actor_name}</span>
                    ) : null}
                  </p>
                  {e.notes ? <p>{e.notes}</p> : null}
                  {details ? <p className="text-xs break-words text-muted">{details}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
