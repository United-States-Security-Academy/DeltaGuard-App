import { SOS_STATUS_LABELS } from '@deltaguard/shared';
import Link from 'next/link';
import { Suspense } from 'react';

import { Badge, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { formatWhen } from '../incidents/data';
import { getTimeZone } from '../schedule/data';
import { SOS_TONE } from './tone';

export default function SosListPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">SOS alerts</h1>
        <Link href="/sos/contacts" className="text-sm font-medium text-accent-ink hover:underline">
          Escalation contacts →
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted">Loading alerts…</p>}>
        <SosList />
      </Suspense>
    </div>
  );
}

function minutesBetween(from: string, to: string | null): string {
  if (!to) return '—';
  const m = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  return m < 1 ? '< 1 min' : `${m} min`;
}

async function SosList() {
  await requireStaff();
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  const { data, error } = await supabase
    .from('sos_alerts')
    .select(
      'id, officer_name, site_name, status, triggered_at, acknowledged_at, acknowledged_by_name, resolved_at, resolved_by_name, escalation_level',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return <ErrorText>Could not load SOS alerts: {error.message}</ErrorText>;
  if (data.length === 0) return <EmptyState>No SOS alerts yet.</EmptyState>;

  return (
    <Table
      head={['Raised', 'Officer', 'Site', 'Status', 'Time to acknowledge', 'Closed by', 'Rounds']}
    >
      {data.map((a) => (
        <tr key={a.id} className={a.status === 'active' ? 'bg-red-50 dark:bg-red-950/30' : ''}>
          <td className="px-3 py-3 whitespace-nowrap">
            <Link href={`/sos/${a.id}`} className="font-medium hover:underline">
              {formatWhen(a.triggered_at, timeZone)}
            </Link>
          </td>
          <td className="px-3 py-3">{a.officer_name}</td>
          <td className="px-3 py-3 text-muted">{a.site_name ?? '—'}</td>
          <td className="px-3 py-3">
            <Badge tone={SOS_TONE[a.status]}>{SOS_STATUS_LABELS[a.status]}</Badge>
          </td>
          <td className="px-3 py-3 tabular-nums">
            {minutesBetween(a.triggered_at, a.acknowledged_at)}
            {a.acknowledged_by_name ? (
              <span className="block text-xs text-muted">{a.acknowledged_by_name}</span>
            ) : null}
          </td>
          <td className="px-3 py-3">{a.resolved_by_name ?? '—'}</td>
          <td className="px-3 py-3 tabular-nums">{a.escalation_level}</td>
        </tr>
      ))}
    </Table>
  );
}
