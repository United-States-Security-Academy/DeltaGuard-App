import {
  addDaysIso,
  firstParam,
  formatDate,
  fromZoned,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUSES,
  incidentCategoryLabel,
  isoDateSchema,
  toZoned,
} from '@deltaguard/shared';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';

import { IncidentStatusBadge, SeverityBadge } from '@/components/status';
import { Button, EmptyState, ErrorText, Select, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../schedule/data';
import { loadFailed } from '@/lib/server-errors';

const LIMIT = 200;

const filtersSchema = z.object({
  // "open" = waiting for a reviewer (submitted or under review).
  status: z.preprocess(firstParam, z.enum(['open', 'all', ...INCIDENT_STATUSES])).catch('open'),
  severity: z.preprocess(firstParam, z.enum(INCIDENT_SEVERITIES).optional()).catch(undefined),
  category: z.preprocess(firstParam, z.enum(INCIDENT_CATEGORIES).optional()).catch(undefined),
  site: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  officer: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  from: z.preprocess(firstParam, isoDateSchema.optional()).catch(undefined),
  to: z.preprocess(firstParam, isoDateSchema.optional()).catch(undefined),
  q: z.preprocess(firstParam, z.string().trim().max(100)).catch(''),
});

export default function IncidentsPage({ searchParams }: PageProps<'/incidents'>) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Incidents</h1>
      <Suspense fallback={<p className="text-slate-500">Loading incidents…</p>}>
        <IncidentsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function IncidentsContent({
  searchParams,
}: {
  searchParams: PageProps<'/incidents'>['searchParams'];
}) {
  await requireStaff();
  const f = filtersSchema.parse(await searchParams);
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);

  let query = supabase
    .from('incidents')
    .select(
      `id, occurred_at, category, severity, status, police_called, submitted_at,
       sites(name),
       officer:profiles!incidents_officer_id_fkey(full_name),
       incident_photos(count)`,
    )
    .order('occurred_at', { ascending: false })
    .limit(LIMIT);
  if (f.status === 'open') query = query.in('status', ['submitted', 'under_review']);
  else if (f.status !== 'all') query = query.eq('status', f.status);
  if (f.severity) query = query.eq('severity', f.severity);
  if (f.category) query = query.eq('category', f.category);
  if (f.site) query = query.eq('site_id', f.site);
  if (f.officer) query = query.eq('officer_id', f.officer);
  // Dates are days in the company time zone.
  if (f.from) query = query.gte('occurred_at', fromZoned(f.from, '00:00', timeZone).toISOString());
  if (f.to)
    query = query.lt(
      'occurred_at',
      fromZoned(addDaysIso(f.to, 1), '00:00', timeZone).toISOString(),
    );
  if (f.q) query = query.ilike('description', `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  const [incidents, sites, officers] = await Promise.all([
    query,
    supabase.from('sites').select('id, name').order('name'),
    supabase.from('profiles').select('id, full_name').order('full_name'),
  ]);
  if (incidents.error) return <ErrorText>{loadFailed('incidents', incidents.error)}</ErrorText>;
  const rows = incidents.data;

  const when = (iso: string) => {
    const zoned = toZoned(iso, timeZone);
    return `${formatDate(zoned.date)} ${zoned.time}`;
  };

  return (
    <>
      <Form action="/incidents" className="flex flex-wrap items-end gap-3">
        <Select label="Status" name="status" defaultValue={f.status}>
          <option value="open">Waiting for review</option>
          <option value="all">All</option>
          {INCIDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INCIDENT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select label="Severity" name="severity" defaultValue={f.severity ?? ''}>
          <option value="">Any</option>
          {INCIDENT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {INCIDENT_SEVERITY_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select label="Category" name="category" defaultValue={f.category ?? ''}>
          <option value="">Any</option>
          {INCIDENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {incidentCategoryLabel(c)}
            </option>
          ))}
        </Select>
        <Select label="Site" name="site" defaultValue={f.site ?? ''}>
          <option value="">All sites</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select label="Reported by" name="officer" defaultValue={f.officer ?? ''}>
          <option value="">Anyone</option>
          {(officers.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name ?? 'Unnamed'}
            </option>
          ))}
        </Select>
        <DateInput label="From" name="from" value={f.from} />
        <DateInput label="To" name="to" value={f.to} />
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Search</span>
          <input
            name="q"
            type="search"
            defaultValue={f.q}
            placeholder="Words in the description"
            className="rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 outline-none focus:border-slate-900 dark:border-slate-700 dark:focus:border-slate-200"
          />
        </label>
        <Button type="submit">Apply</Button>
        <Link href="/incidents" className="py-2 text-sm text-slate-500 hover:underline">
          Reset
        </Link>
      </Form>

      {rows.length === 0 ? (
        <EmptyState>
          {f.status === 'open'
            ? 'No reports are waiting for review.'
            : 'No reports match these filters.'}
        </EmptyState>
      ) : (
        <>
          <Table head={['When', 'Site', 'Category', 'Severity', 'Reported by', 'Photos', 'Status']}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                <td className="px-3 py-3 whitespace-nowrap">
                  <Link href={`/incidents/${r.id}`} className="font-medium hover:underline">
                    {when(r.occurred_at)}
                  </Link>
                </td>
                <td className="px-3 py-3">{r.sites?.name ?? '—'}</td>
                <td className="px-3 py-3">
                  {incidentCategoryLabel(r.category)}
                  {r.police_called ? (
                    <span className="ml-2 text-xs text-slate-500">· police called</span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <SeverityBadge severity={r.severity} />
                </td>
                <td className="px-3 py-3">{r.officer?.full_name ?? '—'}</td>
                <td className="px-3 py-3">{r.incident_photos[0]?.count ?? 0}</td>
                <td className="px-3 py-3">
                  <IncidentStatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </Table>
          {rows.length === LIMIT ? (
            <p className="text-sm text-slate-500">
              Showing the latest {LIMIT}. Narrow the filters to see older reports.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

function DateInput({ label, name, value }: { label: string; name: string; value?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value ?? ''}
        className="rounded-lg border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700"
      />
    </label>
  );
}
