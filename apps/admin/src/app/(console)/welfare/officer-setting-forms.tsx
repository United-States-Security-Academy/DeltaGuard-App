'use client';

import { useActionState, useMemo, useState } from 'react';

import { Button, FormMessage } from '@/components/ui';

import { setOfficerWelfare } from './actions';

type PolicyOption = { id: string; name: string; enabled: boolean };

const select =
  'rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30';

function SettingOptions({ policies }: { policies: PolicyOption[] }) {
  return (
    <>
      <option value="inherit">Follow their site (or the company default)</option>
      {policies.map((p) => (
        <option key={p.id} value={p.id}>
          {p.enabled ? p.name : `${p.name} (switched off)`}
        </option>
      ))}
      <option value="off">No welfare checks</option>
    </>
  );
}

/** Officer profile: this officer's welfare setting. */
export function OfficerWelfareSettingForm({
  officerId,
  current,
  policies,
}: {
  officerId: string;
  /** 'inherit' | 'off' | policy id */
  current: string;
  policies: PolicyOption[];
}) {
  const [state, action, pending] = useActionState(setOfficerWelfare, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="officer_id" value={officerId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Welfare checks for this officer</span>
          <select name="setting" defaultValue={current} className={select}>
            <SettingOptions policies={policies} />
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export type OfficerRow = { id: string; name: string; setting: string; settingLabel: string };

/** Policies page: pick officers, choose a setting, save for all of them. */
export function AssignOfficersForm({
  officers,
  policies,
}: {
  officers: OfficerRow[];
  policies: PolicyOption[];
}) {
  const [state, action, pending] = useActionState(setOfficerWelfare, null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? officers.filter((o) => o.name.toLowerCase().includes(q)) : officers;
  }, [officers, query]);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((o) => chosen.has(o.id));

  return (
    <form action={action} className="flex flex-col gap-3">
      {[...chosen].map((id) => (
        <input key={id} type="hidden" name="officer_id" value={id} />
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find officers"
          aria-label="Find officers"
          className={`${select} min-w-56`}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allShown}
            onChange={() =>
              setChosen((current) => {
                const next = new Set(current);
                for (const o of shown) {
                  if (allShown) next.delete(o.id);
                  else next.add(o.id);
                }
                return next;
              })
            }
            className="size-4 accent-gold"
          />
          Select all shown
        </label>
      </div>
      <ul className="max-h-80 overflow-y-auto rounded-2xl border border-line">
        {shown.map((o) => (
          <li key={o.id} className="border-t border-line first:border-t-0">
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
              <input
                type="checkbox"
                checked={chosen.has(o.id)}
                onChange={() => toggle(o.id)}
                className="size-4 accent-gold"
              />
              <span className="flex-1 font-medium">{o.name}</span>
              <span className="text-xs text-muted">{o.settingLabel}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 ? (
          <li className="px-3 py-4 text-center text-sm text-muted">No officers match.</li>
        ) : null}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Set {chosen.size || 'the chosen'} officer(s) to</span>
          <select name="setting" defaultValue="inherit" className={select}>
            <SettingOptions policies={policies} />
          </select>
        </label>
        <Button type="submit" disabled={pending || chosen.size === 0}>
          {pending ? 'Saving…' : 'Apply'}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
