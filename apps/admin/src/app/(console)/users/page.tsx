import type { User } from '@supabase/supabase-js';
import { Suspense } from 'react';

import { Badge } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { InviteUserForm } from './invite-user-form';
import { UserRowActions } from './user-row-actions';
import { loadFailed } from '@/lib/server-errors';

export default function UsersPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Users</h1>
      <Suspense fallback={<p className="text-slate-500">Loading users…</p>}>
        <UsersContent />
      </Suspense>
    </div>
  );
}

async function UsersContent() {
  const me = await requireAdmin();
  const supabase = await createClient();

  // Profiles and devices are read as the admin (RLS: admins read all).
  // Emails live in auth.users, which only the service role can list.
  const [profiles, devices, authUsers] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, phone, role, employment_status')
      .order('full_name', { ascending: true, nullsFirst: false }),
    supabase
      .from('user_devices')
      .select('user_id, platform, registered_at, integrity_status, integrity_checked_at, integrity_signals')
      .is('revoked_at', null),
    listAllAuthUsers(),
  ]);

  if (profiles.error) {
    return <p className="text-red-600">{loadFailed('users', profiles.error)}</p>;
  }

  const emailById = new Map(authUsers.map((u) => [u.id, u]));
  const deviceById = new Map((devices.data ?? []).map((d) => [d.user_id, d]));

  return (
    <>
      <InviteUserForm />

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email / phone</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Device</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.data.map((p) => {
              const authUser = emailById.get(p.id);
              const device = deviceById.get(p.id);
              const invited = authUser && !authUser.last_sign_in_at;
              return (
                <tr
                  key={p.id}
                  className="border-t border-slate-200 align-top dark:border-slate-800"
                >
                  <td className="px-3 py-3 font-medium">
                    {p.full_name ?? '—'}
                    {p.id === me.userId ? <span className="text-slate-500"> (you)</span> : null}
                  </td>
                  <td className="px-3 py-3">
                    <div>{authUser?.email ?? '—'}</div>
                    <div className="text-slate-500">{p.phone ?? ''}</div>
                    {invited ? <div className="text-amber-600">Invite pending</div> : null}
                  </td>
                  <td className="px-3 py-3 capitalize">{p.role}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={p.employment_status} />
                  </td>
                  <td className="px-3 py-3">
                    {device ? (
                      <>
                        <div className="capitalize">{device.platform}</div>
                        <div className="text-slate-500">
                          since {new Date(device.registered_at).toLocaleDateString('en-GB')}
                        </div>
                        <IntegrityBadge
                          status={device.integrity_status}
                          signals={device.integrity_signals}
                        />
                      </>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {p.id === me.userId ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <UserRowActions
                        userId={p.id}
                        name={p.full_name ?? authUser?.email ?? 'this user'}
                        role={p.role}
                        status={p.employment_status}
                        hasDevice={Boolean(device)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: 'active' | 'suspended' | 'terminated' }) {
  const styles = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    terminated: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  }[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles}`}>
      {status}
    </span>
  );
}

/** All auth users (for emails and invite status). Service role; caller must be an admin. */
async function listAllAuthUsers(): Promise<User[]> {
  const admin = createAdminClient();
  const users: User[] = [];
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) return users;
  }
}

const SIGNAL_LABELS: Record<string, string> = {
  rooted: 'rooted / jailbroken',
  emulator: 'emulator',
  mock_location: 'fake-location app',
};

/** The phone's latest App Attest / Play Integrity verdict and self-reported signals. */
function IntegrityBadge({ status, signals }: { status: string; signals: string[] }) {
  const flagged = status === 'failed' || signals.length > 0;
  const text = flagged
    ? `Security warning${signals.length ? `: ${signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}` : ''}`
    : status === 'verified'
      ? 'Genuine app verified'
      : 'Not verified yet';
  return (
    <div className="mt-1">
      <Badge tone={flagged ? 'bad' : status === 'verified' ? 'good' : 'neutral'}>{text}</Badge>
    </div>
  );
}
