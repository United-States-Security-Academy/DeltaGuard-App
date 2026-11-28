import { SOS_ESCALATION_MINUTES } from '@deltaguard/shared';
import Link from 'next/link';
import { Suspense } from 'react';

import { ActionButton } from '@/components/action-form';
import { Badge, Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { addSosContact, deleteSosContact, toggleSosContact } from './actions';
import { ContactForm } from './contact-form';
import { loadFailed } from '@/lib/server-errors';

export default function SosContactsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/sos" className="text-sm text-muted hover:underline">
        ← SOS alerts
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Escalation contacts</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          An SOS first alerts on-duty supervisors (every supervisor if none is on duty) and all
          admins by push and SMS. If nobody acknowledges within {SOS_ESCALATION_MINUTES} minutes,
          the first contact below gets an SMS, then the next one every {SOS_ESCALATION_MINUTES}{' '}
          minutes, while staff keep getting push reminders. Supervisors and admins need a mobile
          number on their profile to get SMS.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Contacts />
      </Suspense>
    </div>
  );
}

async function Contacts() {
  const staff = await requireStaff();
  const isAdmin = staff.role === 'admin';
  const supabase = await createClient();
  const [contacts, people] = await Promise.all([
    supabase.from('sos_contacts').select('*').order('position').order('created_at'),
    isAdmin
      ? supabase
          .from('profiles')
          .select('id, full_name, role')
          .in('role', ['admin', 'supervisor'])
          .eq('employment_status', 'active')
          .order('full_name')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contacts.error) return <ErrorText>{loadFailed('contacts', contacts.error)}</ErrorText>;

  return (
    <>
      {contacts.data.length === 0 ? (
        <EmptyState>
          No escalation contacts yet. Add the people who must hear about an SOS nobody has answered:
          an operations manager, the owner, a 24/7 monitoring centre.
        </EmptyState>
      ) : (
        <Table head={['Order', 'Name', 'Mobile', 'Status', ...(isAdmin ? [''] : [])]}>
          {contacts.data.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-3 tabular-nums">{c.position}</td>
              <td className="px-3 py-3 font-medium">{c.name}</td>
              <td className="px-3 py-3 tabular-nums">{c.phone}</td>
              <td className="px-3 py-3">
                <Badge tone={c.active ? 'good' : 'neutral'}>{c.active ? 'Active' : 'Paused'}</Badge>
              </td>
              {isAdmin ? (
                <td className="px-3 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <ActionButton
                      action={toggleSosContact}
                      fields={{ id: c.id, active: String(!c.active) }}
                      label={c.active ? 'Pause' : 'Resume'}
                    />
                    <ActionButton
                      action={deleteSosContact}
                      fields={{ id: c.id }}
                      label="Remove"
                      variant="danger"
                      confirm={`Remove ${c.name} from the escalation list?`}
                    />
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}
      {isAdmin ? (
        <Card title="Add a contact">
          <ContactForm
            action={addSosContact}
            nextPosition={(contacts.data.at(-1)?.position ?? 0) + 1}
            people={(people.data ?? []).map((p) => ({
              id: p.id,
              label: `${p.full_name ?? 'Unnamed'} (${p.role})`,
            }))}
          />
        </Card>
      ) : (
        <p className="text-sm text-muted">Only admins can change this list.</p>
      )}
    </>
  );
}
