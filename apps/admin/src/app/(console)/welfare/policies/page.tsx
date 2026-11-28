import Link from 'next/link';
import { Suspense } from 'react';

import { Badge, Card, EmptyState, ErrorText } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { formatSeconds } from '../labels';
import { WelfareTabs } from '../tabs';
import { AssignOfficersForm } from '../officer-setting-forms';
import { CompanyDefaultForm, SiteWelfareForm } from './forms';
import { loadFailed } from '@/lib/server-errors';

export default function WelfarePoliciesPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-muted">Loading policies…</p>}>
        <Policies />
      </Suspense>
    </div>
  );
}

const range = (min: number | null, max: number | null) =>
  min === max ? `${min} min` : `${min}–${max} min`;

async function Policies() {
  await requireAdmin();
  const supabase = await createClient();
  const [policies, settings, sites, officers, officerSettings] = await Promise.all([
    supabase.from('welfare_check_policies').select('*').order('name'),
    supabase.from('settings').select('welfare_policy_id').maybeSingle(),
    supabase
      .from('sites')
      .select('id, name, active, welfare_policy_id, welfare_checks_enabled, clients(name)')
      .order('active', { ascending: false })
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'officer')
      .eq('employment_status', 'active')
      .order('full_name'),
    supabase.from('officer_welfare_settings').select('officer_id, mode, policy_id'),
  ]);
  if (policies.error) return <ErrorText>{loadFailed('policies', policies.error)}</ErrorText>;
  if (sites.error) return <ErrorText>{loadFailed('sites', sites.error)}</ErrorText>;

  const defaultId = settings.data?.welfare_policy_id ?? null;
  const options = policies.data.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled }));
  const defaultPolicy = policies.data.find((p) => p.id === defaultId) ?? null;
  const settingOf = new Map((officerSettings.data ?? []).map((o) => [o.officer_id, o]));
  const officerRows = (officers.data ?? []).map((o) => {
    const own = settingOf.get(o.id);
    const policy = own?.policy_id ? policies.data.find((p) => p.id === own.policy_id) : null;
    return {
      id: o.id,
      name: o.full_name ?? 'Unnamed officer',
      setting: own ? (own.mode === 'off' ? 'off' : own.policy_id!) : 'inherit',
      settingLabel: !own
        ? 'Follows site'
        : own.mode === 'off'
          ? 'Checks off'
          : (policy?.name ?? 'Own policy'),
    };
  });
  const officersUsing = (id: string) =>
    (officerSettings.data ?? []).filter((o) => o.policy_id === id).length;
  const usedBy = (id: string) => sites.data.filter((s) => s.welfare_policy_id === id).length;

  return (
    <>
      <WelfareTabs current="policies" isAdmin />

      <Card title="Company default">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Sites without their own policy use this one. Changes apply from each officer’s next
            check or next clock-in.
          </p>
          <CompanyDefaultForm current={defaultId} policies={options} />
          {defaultPolicy && !defaultPolicy.enabled ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              The default policy is switched off, so sites using it have no checks.
            </p>
          ) : null}
        </div>
      </Card>

      <Card
        title="Policies"
        actions={
          <Link
            href="/welfare/policies/new"
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-navy dark:bg-gold dark:text-ink"
          >
            New policy
          </Link>
        }
      >
        {policies.data.length === 0 ? (
          <EmptyState>No policies yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-3 pr-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Every</th>
                  <th className="px-3 py-3 font-medium">At night</th>
                  <th className="px-3 py-3 font-medium">To answer</th>
                  <th className="px-3 py-3 font-medium">Calls</th>
                  <th className="px-3 py-3 font-medium">Used by</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-b-0">
                {policies.data.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 pr-3">
                      <Link
                        href={`/welfare/policies/${p.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="ml-2 inline-flex gap-1">
                        {p.id === defaultId ? <Badge tone="good">Default</Badge> : null}
                        {p.enabled ? null : <Badge tone="warn">Off</Badge>}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {range(p.min_interval_minutes, p.max_interval_minutes)}
                    </td>
                    <td className="px-3 py-3">
                      {p.night_start && p.night_end
                        ? `${range(p.night_min_interval_minutes, p.night_max_interval_minutes)} (${p.night_start.slice(0, 5)}–${p.night_end.slice(0, 5)})`
                        : 'Same'}
                    </td>
                    <td className="px-3 py-3">
                      {formatSeconds(p.response_seconds)} + {formatSeconds(p.alarm_seconds)} alarm
                    </td>
                    <td className="px-3 py-3">
                      {p.call_attempts === 0
                        ? 'None'
                        : `${p.call_attempts} × every ${formatSeconds(p.call_gap_seconds)}`}
                    </td>
                    <td className="px-3 py-3">
                      {usedBy(p.id)} site{usedBy(p.id) === 1 ? '' : 's'}
                      {officersUsing(p.id)
                        ? `, ${officersUsing(p.id)} officer${officersUsing(p.id) === 1 ? '' : 's'}`
                        : ''}
                      {p.id === defaultId ? ' + default' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Officers">
        <p className="mb-4 text-sm text-muted">
          Give chosen officers their own policy, or no checks at all. An officer’s own setting wins
          over their site and the company default; “Follow their site” removes it. Officers on duty
          get their next check under the new setting straight away.
        </p>
        <AssignOfficersForm officers={officerRows} policies={options} />
      </Card>

      <Card title="Sites">
        <p className="mb-4 text-sm text-muted">
          Choose each site’s policy, or switch checks off there. Turning checks off doesn’t cancel a
          check already under way; it stops new ones.
        </p>
        {sites.data.length === 0 ? (
          <EmptyState>No sites yet.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {sites.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0"
              >
                <div className="min-w-48">
                  <Link href={`/sites/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {s.clients?.name ?? 'No client'}
                    {s.active ? '' : ' · inactive'}
                  </p>
                </div>
                <SiteWelfareForm
                  siteId={s.id}
                  policyId={s.welfare_policy_id}
                  enabled={s.welfare_checks_enabled}
                  policies={options}
                  defaultName={defaultPolicy?.name ?? null}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
