import {
  addDaysIso,
  EMPLOYMENT_STATUSES,
  expiryStatus,
  type OfficerListFilters,
  officerListFiltersSchema,
  todayIso,
} from '@deltaguard/shared';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';

import { EmploymentBadge, ExpiryBadge } from '@/components/status';
import { Button, EmptyState, ErrorText, Select, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default function OfficersPage({ searchParams }: PageProps<'/officers'>) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Officers</h1>
      <Suspense fallback={<p className="text-slate-500">Loading officers…</p>}>
        <OfficersContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function OfficersContent({
  searchParams,
}: {
  searchParams: PageProps<'/officers'>['searchParams'];
}) {
  await requireStaff();
  const filters = officerListFiltersSchema.parse(await searchParams);
  const supabase = await createClient();

  // RLS: admins read every profile, supervisors read officers. Details and
  // qualifications come along as embedded relations (both reference profiles).
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, phone, employment_status, officer_details(employee_number), qualifications(type, expires_on)',
    )
    .eq('role', 'officer')
    .order('full_name', { ascending: true, nullsFirst: false });

  if (error) return <ErrorText>Could not load officers: {error.message}</ErrorText>;

  const today = todayIso();
  const officers = data
    .map((o) => {
      // The licence that needs attention first: the earliest expiry date.
      const nextExpiry =
        o.qualifications
          .map((q) => q.expires_on)
          .filter((d): d is string => d !== null)
          .sort()[0] ?? null;
      return { ...o, nextExpiry };
    })
    .filter((o) => matches(o, filters, today));

  return (
    <>
      <FilterBar filters={filters} />
      <p className="text-sm text-slate-500">
        {officers.length} {officers.length === 1 ? 'officer' : 'officers'}
      </p>
      {officers.length === 0 ? (
        <EmptyState>No officers match these filters.</EmptyState>
      ) : (
        <Table head={['Name', 'Employee no.', 'Phone', 'Status', 'Next licence expiry']}>
          {officers.map((o) => (
            <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
              <td className="px-3 py-3 font-medium">
                <Link href={`/officers/${o.id}`} className="hover:underline">
                  {o.full_name ?? 'Unnamed officer'}
                </Link>
              </td>
              <td className="px-3 py-3">{o.officer_details?.employee_number ?? '—'}</td>
              <td className="px-3 py-3">{o.phone ?? '—'}</td>
              <td className="px-3 py-3">
                <EmploymentBadge status={o.employment_status} />
              </td>
              <td className="px-3 py-3">
                {o.nextExpiry ? (
                  <ExpiryBadge expiresOn={o.nextExpiry} today={today} />
                ) : (
                  <span className="text-slate-500">No licences recorded</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

type Row = {
  full_name: string | null;
  phone: string | null;
  employment_status: (typeof EMPLOYMENT_STATUSES)[number];
  officer_details: { employee_number: string | null } | null;
  qualifications: { expires_on: string | null }[];
};

function matches(o: Row, f: OfficerListFilters, today: string): boolean {
  if (f.status !== 'all' && o.employment_status !== f.status) return false;

  if (f.q) {
    const needle = f.q.toLowerCase();
    const haystack = [o.full_name, o.phone, o.officer_details?.employee_number]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (f.licence) {
    const statuses = o.qualifications.map((q) => expiryStatus(q.expires_on, today));
    if (f.licence === 'expired') {
      if (!statuses.some((s) => s.kind === 'expired')) return false;
    } else {
      // "Expiring within N days": still valid today, expires on or before today + N.
      const limit = addDaysIso(today, Number(f.licence));
      const hit = o.qualifications.some(
        (q) => q.expires_on !== null && q.expires_on >= today && q.expires_on <= limit,
      );
      if (!hit) return false;
    }
  }
  return true;
}

/** GET form: filters live in the URL, so a filtered list can be bookmarked or shared. */
function FilterBar({ filters }: { filters: OfficerListFilters }) {
  return (
    <Form action="/officers" className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">Search</span>
        <input
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="Name, phone or employee number"
          className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-slate-900 dark:border-slate-700 dark:focus:border-slate-200"
        />
      </label>
      <Select label="Status" name="status" defaultValue={filters.status}>
        <option value="all">All statuses</option>
        {EMPLOYMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s[0]?.toUpperCase() + s.slice(1)}
          </option>
        ))}
      </Select>
      <Select label="Licences" name="licence" defaultValue={filters.licence ?? ''}>
        <option value="">Any</option>
        <option value="30">Expiring within 30 days</option>
        <option value="60">Expiring within 60 days</option>
        <option value="expired">Already expired</option>
      </Select>
      <Button type="submit">Apply</Button>
      <Link href="/officers" className="py-2 text-sm text-slate-500 hover:underline">
        Reset
      </Link>
    </Form>
  );
}
