import { firstParam } from '@deltaguard/shared';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';

import { Badge, Button, EmptyState, ErrorText, Select, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const filtersSchema = z.object({
  q: z.preprocess(firstParam, z.string().trim().max(100)).catch(''),
  client: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
});

export default function SitesPage({ searchParams }: PageProps<'/sites'>) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-slate-500">Loading sites…</p>}>
        <SitesContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SitesContent({
  searchParams,
}: {
  searchParams: PageProps<'/sites'>['searchParams'];
}) {
  const staff = await requireStaff();
  const filters = filtersSchema.parse(await searchParams);
  const supabase = await createClient();

  const [sites, clients] = await Promise.all([
    supabase
      .from('sites')
      .select(
        'id, name, address, latitude, longitude, clock_in_radius_m, active, client_id, clients(name), site_assignments(count)',
      )
      .order('name'),
    supabase.from('clients').select('id, name').order('name'),
  ]);
  if (sites.error) return <ErrorText>Could not load sites: {sites.error.message}</ErrorText>;

  const needle = filters.q.toLowerCase();
  const rows = sites.data.filter(
    (s) =>
      (!filters.client || s.client_id === filters.client) &&
      (!needle || `${s.name} ${s.address ?? ''}`.toLowerCase().includes(needle)),
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Sites</h1>
        {staff.role === 'admin' ? (
          <Link
            href="/sites/new"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
          >
            Add site
          </Link>
        ) : null}
      </div>

      <Form action="/sites" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Search</span>
          <input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Site name or address"
            className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-slate-900 dark:border-slate-700 dark:focus:border-slate-200"
          />
        </label>
        <Select label="Client" name="client" defaultValue={filters.client ?? ''}>
          <option value="">All clients</option>
          {(clients.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button type="submit">Apply</Button>
        <Link href="/sites" className="py-2 text-sm text-slate-500 hover:underline">
          Reset
        </Link>
      </Form>

      {rows.length === 0 ? (
        <EmptyState>
          {sites.data.length === 0 ? 'No sites yet.' : 'No sites match these filters.'}
        </EmptyState>
      ) : (
        <Table head={['Site', 'Client', 'Address', 'Location', 'Officers', 'Status']}>
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
              <td className="px-3 py-3 font-medium">
                <Link href={`/sites/${s.id}`} className="hover:underline">
                  {s.name}
                </Link>
              </td>
              <td className="px-3 py-3">{s.clients?.name ?? '—'}</td>
              <td className="px-3 py-3">{s.address ?? '—'}</td>
              <td className="px-3 py-3">
                {s.latitude !== null ? (
                  <span>{s.clock_in_radius_m} m radius</span>
                ) : (
                  <Badge tone="warn">Not set</Badge>
                )}
              </td>
              <td className="px-3 py-3">{s.site_assignments[0]?.count ?? 0}</td>
              <td className="px-3 py-3">
                <Badge tone={s.active ? 'good' : 'neutral'}>
                  {s.active ? 'Active' : 'Inactive'}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
