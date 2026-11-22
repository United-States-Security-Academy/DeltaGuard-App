import { formatDate, parseSiteContacts, recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ActionButton, PickForm } from '@/components/action-form';
import { EmploymentBadge } from '@/components/status';
import { Badge, Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { deleteSite } from '../actions';
import { assignOfficer, unassignOfficer } from '../assignment-actions';
import { fallbackMapCenter } from '../data';
import { SiteForm } from '../site-form';

type Props = PageProps<'/sites/[id]'>;

export default function SitePage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/sites" className="text-sm text-slate-500 hover:underline">
        ← All sites
      </Link>
      <Suspense fallback={<p className="text-slate-500">Loading site…</p>}>
        <SiteContent params={params} />
      </Suspense>
    </div>
  );
}

async function SiteContent({ params }: Pick<Props, 'params'>) {
  const staff = await requireStaff();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();
  const isAdmin = staff.role === 'admin';

  const supabase = await createClient();
  const [siteResult, assignments, officers, clients, center, postOrders] = await Promise.all([
    supabase.from('sites').select('*, clients(id, name)').eq('id', id.data.id).maybeSingle(),
    supabase
      .from('site_assignments')
      .select('officer_id, created_at, profiles(full_name, phone, employment_status)')
      .eq('site_id', id.data.id),
    isAdmin
      ? supabase
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'officer')
          .eq('employment_status', 'active')
          .order('full_name')
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    isAdmin
      ? supabase.from('clients').select('id, name').order('name')
      : Promise.resolve({ data: null }),
    fallbackMapCenter(supabase),
    supabase
      .from('post_orders')
      .select('id, title, version, published_at, archived_at')
      .eq('site_id', id.data.id)
      .order('archived_at', { ascending: true, nullsFirst: true })
      .order('title'),
  ]);

  if (siteResult.error)
    return <ErrorText>Could not load this site: {siteResult.error.message}</ErrorText>;
  const site = siteResult.data;
  if (!site) notFound();

  const assigned = assignments.data ?? [];
  const assignedIds = new Set(assigned.map((a) => a.officer_id));
  const options = (officers.data ?? [])
    .filter((o) => !assignedIds.has(o.id))
    .map((o) => ({ value: o.id, label: o.full_name ?? 'Unnamed officer' }));

  // Assigned officers who acknowledged each post order's current version.
  const orders = postOrders.data ?? [];
  const acks = orders.length
    ? await supabase
        .from('post_order_acknowledgements')
        .select('post_order_id, officer_id, version')
        .in(
          'post_order_id',
          orders.map((o) => o.id),
        )
    : { data: [] };
  const upToDate = (orderId: string, version: number) =>
    new Set(
      (acks.data ?? [])
        .filter(
          (a) =>
            a.post_order_id === orderId && a.version >= version && assignedIds.has(a.officer_id),
        )
        .map((a) => a.officer_id),
    ).size;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{site.name}</h1>
          {site.clients ? (
            <Link
              href={`/clients/${site.clients.id}`}
              className="text-sm text-slate-500 hover:underline"
            >
              {site.clients.name}
            </Link>
          ) : null}
        </div>
        {isAdmin ? (
          <ActionButton
            action={deleteSite}
            fields={{ id: site.id }}
            label="Delete site"
            variant="danger"
            confirm={`Delete ${site.name}? Its officer assignments are removed too. To keep its history, untick "Active" instead.`}
          />
        ) : null}
      </div>

      <Card title={`Assigned officers (${assigned.length})`}>
        <div className="flex flex-col gap-4">
          {assigned.length === 0 ? (
            <EmptyState>No officers assigned yet.</EmptyState>
          ) : (
            <Table head={['Officer', 'Phone', 'Status', 'Since', ...(isAdmin ? [''] : [])]}>
              {assigned.map((a) => (
                <tr key={a.officer_id}>
                  <td className="px-3 py-3 font-medium">
                    <Link href={`/officers/${a.officer_id}?tab=sites`} className="hover:underline">
                      {a.profiles?.full_name ?? 'Unnamed officer'}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{a.profiles?.phone ?? '—'}</td>
                  <td className="px-3 py-3">
                    {a.profiles ? <EmploymentBadge status={a.profiles.employment_status} /> : '—'}
                  </td>
                  <td className="px-3 py-3">{formatDate(a.created_at.slice(0, 10))}</td>
                  {isAdmin ? (
                    <td className="px-3 py-3">
                      <ActionButton
                        action={unassignOfficer}
                        fields={{ site_id: site.id, officer_id: a.officer_id }}
                        label="Remove"
                        confirm={`Remove ${a.profiles?.full_name ?? 'this officer'} from ${site.name}?`}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </Table>
          )}
          {isAdmin ? (
            options.length > 0 ? (
              <PickForm
                action={assignOfficer}
                fields={{ site_id: site.id }}
                name="officer_id"
                label="Assign an officer"
                placeholder="Choose an officer…"
                options={options}
                submitLabel="Assign"
              />
            ) : (
              <p className="text-sm text-slate-500">
                Every active officer is already assigned here.
              </p>
            )
          ) : null}
        </div>
      </Card>

      <Card
        title={`Post orders (${orders.filter((o) => !o.archived_at).length})`}
        actions={
          <Link
            href={`/sites/${site.id}/post-orders/new`}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            New post order
          </Link>
        }
      >
        {postOrders.error ? (
          <ErrorText>Could not load post orders: {postOrders.error.message}</ErrorText>
        ) : orders.length === 0 ? (
          <EmptyState>
            No post orders yet. Officers must acknowledge a site&apos;s post orders before they
            clock in there.
          </EmptyState>
        ) : (
          <Table head={['Title', 'Version', 'Published', 'Acknowledged', 'Status']}>
            {orders.map((o) => {
              const done = upToDate(o.id, o.version);
              return (
                <tr key={o.id}>
                  <td className="px-3 py-3 font-medium">
                    <Link
                      href={`/sites/${site.id}/post-orders/${o.id}`}
                      className="hover:underline"
                    >
                      {o.title}
                    </Link>
                  </td>
                  <td className="px-3 py-3">v{o.version}</td>
                  <td className="px-3 py-3">{formatDate(o.published_at.slice(0, 10))}</td>
                  <td className="px-3 py-3">
                    {o.archived_at ? (
                      '—'
                    ) : (
                      <Badge tone={done === assigned.length ? 'good' : 'warn'}>
                        {done} of {assigned.length}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={o.archived_at ? 'neutral' : 'good'}>
                      {o.archived_at ? 'Retired' : 'Active'}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title="Site details">
        <SiteForm
          values={{
            id: site.id,
            clientId: site.client_id,
            name: site.name,
            address: site.address ?? '',
            latitude: site.latitude,
            longitude: site.longitude,
            radius: site.clock_in_radius_m,
            emergencyInstructions: site.emergency_instructions ?? '',
            contacts: parseSiteContacts(site.site_contacts),
            active: site.active,
          }}
          clients={clients.data}
          fallbackCenter={center}
        />
      </Card>
    </>
  );
}
