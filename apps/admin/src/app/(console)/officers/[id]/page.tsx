import {
  type EmergencyContact,
  emergencyContactSchema,
  formatDate,
  type OfficerTab,
  officerTabSchema,
  recordIdSchema,
  todayIso,
} from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';

import { ActionButton, PickForm } from '@/components/action-form';
import { EmploymentBadge, ExpiryBadge } from '@/components/status';
import { Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff, type StaffSession } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { assignOfficer, unassignOfficer } from '../../sites/assignment-actions';
import { deleteQualification } from '../actions';
import { OfficerDetailsForm } from './details-form';
import { QualificationForm } from './qualification-form';

type Props = PageProps<'/officers/[id]'>;

export default function OfficerPage({ params, searchParams }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/officers" className="text-sm text-slate-500 hover:underline">
        ← All officers
      </Link>
      <Suspense fallback={<p className="text-slate-500">Loading officer…</p>}>
        <OfficerContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function OfficerContent({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  const staff = await requireStaff();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();
  const tab = officerTabSchema.parse((await searchParams).tab);
  const officerId = id.data.id;

  const supabase = await createClient();
  const { data: officer, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, employment_status, officer_details(*)')
    .eq('id', officerId)
    .maybeSingle();

  if (error) return <ErrorText>Could not load this officer: {error.message}</ErrorText>;
  if (!officer || officer.role !== 'officer') notFound();

  // Emails live in auth.users; only the service role can read them, so only
  // admins see them (same rule as the Users page).
  let email: string | null = null;
  if (staff.role === 'admin') {
    const { data } = await createAdminClient().auth.admin.getUserById(officerId);
    email = data.user?.email ?? null;
  }

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{officer.full_name ?? 'Unnamed officer'}</h1>
          <EmploymentBadge status={officer.employment_status} />
        </div>
        <p className="text-sm text-slate-500">
          {[officer.officer_details?.employee_number, officer.phone, email]
            .filter(Boolean)
            .join(' · ') || 'No contact details yet'}
        </p>
      </header>

      <Tabs officerId={officerId} current={tab} />

      {tab === 'details' ? (
        <DetailsTab staff={staff} officer={officer} />
      ) : tab === 'qualifications' ? (
        <QualificationsTab staff={staff} officerId={officerId} />
      ) : (
        <SitesTab
          staff={staff}
          officerId={officerId}
          active={officer.employment_status === 'active'}
        />
      )}
    </>
  );
}

const TAB_LABELS: Record<OfficerTab, string> = {
  details: 'Details',
  qualifications: 'Qualifications',
  sites: 'Assigned sites',
};

function Tabs({ officerId, current }: { officerId: string; current: OfficerTab }) {
  return (
    <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {(Object.keys(TAB_LABELS) as OfficerTab[]).map((t) => (
        <Link
          key={t}
          href={`/officers/${officerId}?tab=${t}`}
          aria-current={t === current ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            t === current
              ? 'border-slate-900 dark:border-white'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          {TAB_LABELS[t]}
        </Link>
      ))}
    </nav>
  );
}

// Details ----------------------------------------------------------------------

type OfficerRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  officer_details: {
    employee_number: string | null;
    address: string | null;
    date_hired: string | null;
    emergency_contact: unknown;
  } | null;
};

function DetailsTab({ staff, officer }: { staff: StaffSession; officer: OfficerRow }) {
  const d = officer.officer_details;
  const parsedContact = emergencyContactSchema.safeParse(d?.emergency_contact);
  const contact: EmergencyContact | null = parsedContact.success ? parsedContact.data : null;

  if (staff.role === 'admin') {
    return (
      <Card>
        <OfficerDetailsForm
          values={{
            userId: officer.id,
            fullName: officer.full_name ?? '',
            phone: officer.phone ?? '',
            employeeNumber: d?.employee_number ?? '',
            address: d?.address ?? '',
            dateHired: d?.date_hired ?? '',
            contactName: contact?.name ?? '',
            contactRelationship: contact?.relationship ?? '',
            contactPhone: contact?.phone ?? '',
          }}
        />
      </Card>
    );
  }

  // Supervisors: read-only (RLS lets them read, not write).
  return (
    <Card>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Item label="Phone">{officer.phone ?? '—'}</Item>
        <Item label="Employee number">{d?.employee_number ?? '—'}</Item>
        <Item label="Date hired">{formatDate(d?.date_hired)}</Item>
        <Item label="Home address">{d?.address ?? '—'}</Item>
        <Item label="Emergency contact">
          {contact
            ? `${contact.name}${contact.relationship ? ` (${contact.relationship})` : ''}, ${contact.phone}`
            : '—'}
        </Item>
      </dl>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="whitespace-pre-line">{children}</dd>
    </div>
  );
}

// Qualifications ---------------------------------------------------------------

async function QualificationsTab({ staff, officerId }: { staff: StaffSession; officerId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('qualifications')
    .select('id, type, license_number, issued_on, expires_on, document_path')
    .eq('user_id', officerId)
    .order('expires_on', { ascending: true, nullsFirst: false });
  if (error) return <ErrorText>Could not load qualifications: {error.message}</ErrorText>;

  const today = todayIso();
  const isAdmin = staff.role === 'admin';

  return (
    <div className="flex flex-col gap-6">
      {data.length === 0 ? (
        <EmptyState>No licences or certificates recorded yet.</EmptyState>
      ) : (
        <Table
          head={['Type', 'Licence no.', 'Issued', 'Expires', 'Scan', ...(isAdmin ? [''] : [])]}
        >
          {data.map((q) => (
            <tr key={q.id} className="align-top">
              <td className="px-3 py-3 font-medium">{q.type}</td>
              <td className="px-3 py-3">{q.license_number ?? '—'}</td>
              <td className="px-3 py-3">{formatDate(q.issued_on)}</td>
              <td className="px-3 py-3">
                <div className="flex flex-col items-start gap-1">
                  <span>{formatDate(q.expires_on)}</span>
                  {q.expires_on ? <ExpiryBadge expiresOn={q.expires_on} today={today} /> : null}
                </div>
              </td>
              <td className="px-3 py-3">
                {q.document_path ? (
                  // A short-lived signed link is created when clicked.
                  <a
                    href={`/scans/${q.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </td>
              {isAdmin ? (
                <td className="px-3 py-3">
                  <ActionButton
                    action={deleteQualification}
                    fields={{ id: q.id }}
                    label="Delete"
                    variant="danger"
                    confirm={`Delete "${q.type}" and its scan? This cannot be undone.`}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {isAdmin ? (
        <Card title="Add qualification">
          <QualificationForm userId={officerId} />
        </Card>
      ) : null}
    </div>
  );
}

// Sites ------------------------------------------------------------------------

async function SitesTab({
  staff,
  officerId,
  active,
}: {
  staff: StaffSession;
  officerId: string;
  active: boolean;
}) {
  const supabase = await createClient();
  const [assigned, allSites] = await Promise.all([
    supabase
      .from('site_assignments')
      .select('site_id, created_at, sites(id, name, address, active, clients(name))')
      .eq('officer_id', officerId),
    supabase.from('sites').select('id, name, clients(name)').eq('active', true).order('name'),
  ]);
  if (assigned.error) return <ErrorText>Could not load sites: {assigned.error.message}</ErrorText>;

  const isAdmin = staff.role === 'admin';
  const assignedIds = new Set(assigned.data.map((a) => a.site_id));
  const options = (allSites.data ?? [])
    .filter((s) => !assignedIds.has(s.id))
    .map((s) => ({ value: s.id, label: `${s.name}${s.clients ? ` (${s.clients.name})` : ''}` }));

  return (
    <div className="flex flex-col gap-6">
      {assigned.data.length === 0 ? (
        <EmptyState>Not assigned to any site.</EmptyState>
      ) : (
        <Table head={['Site', 'Client', 'Address', 'Since', ...(isAdmin ? [''] : [])]}>
          {assigned.data.map((a) => (
            <tr key={a.site_id} className="align-top">
              <td className="px-3 py-3 font-medium">
                <Link href={`/sites/${a.site_id}`} className="hover:underline">
                  {a.sites?.name ?? 'Unknown site'}
                </Link>
                {a.sites && !a.sites.active ? (
                  <span className="ml-2 text-xs text-slate-500">(inactive)</span>
                ) : null}
              </td>
              <td className="px-3 py-3">{a.sites?.clients?.name ?? '—'}</td>
              <td className="px-3 py-3">{a.sites?.address ?? '—'}</td>
              <td className="px-3 py-3">{formatDate(a.created_at.slice(0, 10))}</td>
              {isAdmin ? (
                <td className="px-3 py-3">
                  <ActionButton
                    action={unassignOfficer}
                    fields={{ site_id: a.site_id, officer_id: officerId }}
                    label="Remove"
                    confirm={`Remove this officer from ${a.sites?.name ?? 'this site'}?`}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {isAdmin ? (
        <Card title="Assign to a site">
          {!active ? (
            <p className="text-sm text-slate-500">Only active officers can be assigned.</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-slate-500">
              No other active sites.{' '}
              <Link href="/sites/new" className="underline">
                Add a site
              </Link>
            </p>
          ) : (
            <PickForm
              action={assignOfficer}
              fields={{ officer_id: officerId }}
              name="site_id"
              label="Site"
              placeholder="Choose a site…"
              options={options}
              submitLabel="Assign"
            />
          )}
        </Card>
      ) : null}
    </div>
  );
}
