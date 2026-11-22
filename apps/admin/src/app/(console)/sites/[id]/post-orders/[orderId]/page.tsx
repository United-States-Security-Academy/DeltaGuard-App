import { formatDate, toZoned } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { ActionButton } from '@/components/action-form';
import { Markdown } from '@/components/markdown';
import { Badge, Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../../../schedule/data';
import { setPostOrderArchived } from '../../../post-order-actions';
import { PostOrderForm } from '../post-order-form';

type Props = PageProps<'/sites/[id]/post-orders/[orderId]'>;

const paramsSchema = z.object({ id: z.uuid(), orderId: z.uuid() });

export default function PostOrderPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-slate-500">Loading post order…</p>}>
        <PostOrderContent params={params} />
      </Suspense>
    </div>
  );
}

type AckState = 'current' | 'outdated' | 'never';

async function PostOrderContent({ params }: Pick<Props, 'params'>) {
  await requireStaff();
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { id: siteId, orderId } = parsed.data;

  const supabase = await createClient();
  const [orderResult, versions, acks, assignments, timeZone] = await Promise.all([
    supabase
      .from('post_orders')
      .select('*, sites(id, name)')
      .eq('id', orderId)
      .eq('site_id', siteId)
      .maybeSingle(),
    supabase
      .from('post_order_versions')
      .select('version, title, body, published_at, profiles(full_name)')
      .eq('post_order_id', orderId)
      .order('version', { ascending: false }),
    supabase
      .from('post_order_acknowledgements')
      .select('officer_id, version, acknowledged_at')
      .eq('post_order_id', orderId),
    supabase
      .from('site_assignments')
      .select('officer_id, profiles(full_name, employment_status)')
      .eq('site_id', siteId),
    getTimeZone(supabase),
  ]);

  if (orderResult.error)
    return <ErrorText>Could not load this post order: {orderResult.error.message}</ErrorText>;
  const order = orderResult.data;
  if (!order) notFound();

  const when = (iso: string) => {
    const zoned = toZoned(iso, timeZone);
    return `${formatDate(zoned.date)} ${zoned.time}`;
  };

  // Latest acknowledgement per officer.
  const latest = new Map<string, { version: number; at: string }>();
  for (const a of acks.data ?? []) {
    const prev = latest.get(a.officer_id);
    if (!prev || a.version > prev.version)
      latest.set(a.officer_id, { version: a.version, at: a.acknowledged_at });
  }
  const ackCountByVersion = new Map<number, number>();
  for (const a of acks.data ?? [])
    ackCountByVersion.set(a.version, (ackCountByVersion.get(a.version) ?? 0) + 1);

  const rank: Record<AckState, number> = { never: 0, outdated: 1, current: 2 };
  const rows = (assignments.data ?? [])
    .map((a) => {
      const ack = latest.get(a.officer_id);
      const state: AckState = !ack
        ? 'never'
        : ack.version >= order.version
          ? 'current'
          : 'outdated';
      return {
        officerId: a.officer_id,
        name: a.profiles?.full_name ?? 'Unnamed officer',
        active: a.profiles?.employment_status === 'active',
        ack,
        state,
      };
    })
    .sort((x, y) => rank[x.state] - rank[y.state] || x.name.localeCompare(y.name));
  const upToDate = rows.filter((r) => r.state === 'current').length;
  const archived = order.archived_at !== null;

  return (
    <>
      <Link href={`/sites/${siteId}`} className="text-sm text-slate-500 hover:underline">
        ← {order.sites?.name ?? 'Site'}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{order.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Badge tone={archived ? 'neutral' : 'good'}>{archived ? 'Retired' : 'Active'}</Badge>
            <span>
              Version {order.version} · published {when(order.published_at)}
            </span>
          </div>
        </div>
        <ActionButton
          action={setPostOrderArchived}
          fields={{ id: order.id, archive: archived ? 'false' : 'true' }}
          label={archived ? 'Restore' : 'Retire'}
          confirm={
            archived
              ? `Restore "${order.title}"? Officers will see it again and must have acknowledged version ${order.version} to clock in.`
              : `Retire "${order.title}"? Officers stop seeing it and no longer need to acknowledge it. Its history and acknowledgements are kept.`
          }
        />
      </div>

      <Card
        title={`Acknowledgements: ${upToDate} of ${rows.length} officers on version ${order.version}`}
      >
        {rows.length === 0 ? (
          <EmptyState>No officers are assigned to this site.</EmptyState>
        ) : (
          <Table head={['Officer', 'Status', 'Acknowledged version', 'When']}>
            {rows.map((r) => (
              <tr key={r.officerId}>
                <td className="px-3 py-3 font-medium">
                  <Link href={`/officers/${r.officerId}`} className="hover:underline">
                    {r.name}
                  </Link>
                  {!r.active ? (
                    <span className="ml-2 text-xs text-slate-500">(inactive)</span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  {r.state === 'current' ? (
                    <Badge tone="good">Up to date</Badge>
                  ) : r.state === 'outdated' ? (
                    <Badge tone="warn">Needs to re-acknowledge</Badge>
                  ) : (
                    <Badge tone="bad">Not acknowledged</Badge>
                  )}
                </td>
                <td className="px-3 py-3">{r.ack ? `v${r.ack.version}` : '—'}</td>
                <td className="px-3 py-3">{r.ack ? when(r.ack.at) : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Officers who are not up to date can&apos;t clock in at this site until they acknowledge
          the current version in the app.
        </p>
      </Card>

      <Card title="Edit">
        <PostOrderForm
          values={{
            id: order.id,
            siteId,
            title: order.title,
            body: order.body,
            version: order.version,
          }}
        />
      </Card>

      <Card title={`Version history (${versions.data?.length ?? 0})`}>
        {versions.error ? (
          <ErrorText>Could not load the history: {versions.error.message}</ErrorText>
        ) : (
          <div className="flex flex-col gap-2">
            {(versions.data ?? []).map((v) => (
              <details
                key={v.version}
                open={v.version === order.version}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <summary className="cursor-pointer text-sm">
                  <span className="font-semibold">Version {v.version}</span>
                  {v.version === order.version ? (
                    <span className="ml-2">
                      <Badge tone="good">Current</Badge>
                    </span>
                  ) : null}
                  <span className="ml-2 text-slate-500">
                    {when(v.published_at)}
                    {v.profiles?.full_name ? ` by ${v.profiles.full_name}` : ''} ·{' '}
                    {ackCountByVersion.get(v.version) ?? 0} acknowledged
                  </span>
                </summary>
                <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                  <p className="font-semibold">{v.title}</p>
                  <Markdown source={v.body} />
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
