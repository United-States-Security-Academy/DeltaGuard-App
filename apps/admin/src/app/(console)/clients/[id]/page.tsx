import { recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ActionButton } from '@/components/action-form';
import { Badge, Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { deleteClient } from '../actions';
import { ClientForm } from '../client-form';
import { loadFailed } from '@/lib/server-errors';

type Props = PageProps<'/clients/[id]'>;

export default function ClientPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/clients" className="text-sm text-slate-500 hover:underline">
        ← All clients
      </Link>
      <Suspense fallback={<p className="text-slate-500">Loading client…</p>}>
        <ClientContent params={params} />
      </Suspense>
    </div>
  );
}

async function ClientContent({ params }: Pick<Props, 'params'>) {
  const staff = await requireStaff();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();

  const supabase = await createClient();
  const { data: client, error } = await supabase
    .from('clients')
    .select('*, sites(id, name, address, active)')
    .eq('id', id.data.id)
    .maybeSingle();
  if (error) return <ErrorText>{loadFailed('this client', error)}</ErrorText>;
  if (!client) notFound();

  const isAdmin = staff.role === 'admin';
  const sites = [...client.sites].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{client.name}</h1>
        {isAdmin ? (
          <ActionButton
            action={deleteClient}
            fields={{ id: client.id }}
            label="Delete client"
            variant="danger"
            confirm={`Delete ${client.name}? This cannot be undone.`}
          />
        ) : null}
      </div>

      <Card
        title="Sites"
        actions={
          isAdmin ? (
            <Link href={`/sites/new?client=${client.id}`} className="text-sm underline">
              Add site
            </Link>
          ) : null
        }
      >
        {sites.length === 0 ? (
          <EmptyState>No sites for this client yet.</EmptyState>
        ) : (
          <Table head={['Site', 'Address', 'Status']}>
            {sites.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-3 font-medium">
                  <Link href={`/sites/${s.id}`} className="hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-3 py-3">{s.address ?? '—'}</td>
                <td className="px-3 py-3">
                  <Badge tone={s.active ? 'good' : 'neutral'}>
                    {s.active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {isAdmin ? (
        <Card title="Client details">
          <ClientForm
            values={{
              id: client.id,
              name: client.name,
              contactPerson: client.contact_person ?? '',
              phone: client.phone ?? '',
              email: client.email ?? '',
              notes: client.notes ?? '',
            }}
          />
        </Card>
      ) : (
        <Card title="Client details">
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              ['Contact person', client.contact_person],
              ['Phone', client.phone],
              ['Email', client.email],
              ['Notes', client.notes],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-slate-500">{label}</dt>
                <dd className="whitespace-pre-line">{value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </>
  );
}
