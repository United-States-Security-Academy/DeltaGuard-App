import Link from 'next/link';
import { Suspense } from 'react';

import { Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { ClientForm } from './client-form';

export default function ClientsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Clients</h1>
      <Suspense fallback={<p className="text-slate-500">Loading clients…</p>}>
        <ClientsContent />
      </Suspense>
    </div>
  );
}

async function ClientsContent() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, contact_person, phone, email, sites(count)')
    .order('name');
  if (error) return <ErrorText>Could not load clients: {error.message}</ErrorText>;

  return (
    <>
      {data.length === 0 ? (
        <EmptyState>No clients yet.</EmptyState>
      ) : (
        <Table head={['Name', 'Contact', 'Phone', 'Email', 'Sites']}>
          {data.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
              <td className="px-3 py-3 font-medium">
                <Link href={`/clients/${c.id}`} className="hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="px-3 py-3">{c.contact_person ?? '—'}</td>
              <td className="px-3 py-3">{c.phone ?? '—'}</td>
              <td className="px-3 py-3">{c.email ?? '—'}</td>
              <td className="px-3 py-3">{c.sites[0]?.count ?? 0}</td>
            </tr>
          ))}
        </Table>
      )}

      {staff.role === 'admin' ? (
        <Card title="Add client">
          <ClientForm />
        </Card>
      ) : null}
    </>
  );
}
