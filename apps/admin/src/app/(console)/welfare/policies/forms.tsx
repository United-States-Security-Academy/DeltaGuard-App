'use client';

import { useActionState, useState } from 'react';

import { Button, Field, FormMessage } from '@/components/ui';

import {
  createWelfarePolicy,
  deleteWelfarePolicy,
  saveSiteWelfare,
  setCompanyWelfarePolicy,
  updateWelfarePolicy,
} from '../actions';
import type { PolicyValues } from './policy-values';

type PolicyOption = { id: string; name: string; enabled: boolean };

const select =
  'rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30';

function optionLabel(p: PolicyOption) {
  return p.enabled ? p.name : `${p.name} (switched off)`;
}

/** The company default policy (null = only sites with their own policy run checks). */
export function CompanyDefaultForm({
  current,
  policies,
}: {
  current: string | null;
  policies: PolicyOption[];
}) {
  const [state, action, pending] = useActionState(setCompanyWelfarePolicy, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Company default policy</span>
          <select name="welfare_policy_id" defaultValue={current ?? ''} className={select}>
            <option value="">None (no checks unless a site has its own policy)</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {optionLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save default'}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** One site's policy and on/off switch (a row of the sites table). */
export function SiteWelfareForm({
  siteId,
  policyId,
  enabled,
  policies,
  defaultName,
}: {
  siteId: string;
  policyId: string | null;
  enabled: boolean;
  policies: PolicyOption[];
  defaultName: string | null;
}) {
  const [state, action, pending] = useActionState(saveSiteWelfare, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="site_id" value={siteId} />
      <select
        name="welfare_policy_id"
        defaultValue={policyId ?? ''}
        aria-label="Policy"
        className={select}
      >
        <option value="">Company default{defaultName ? ` (${defaultName})` : ' (none)'}</option>
        {policies.map((p) => (
          <option key={p.id} value={p.id}>
            {optionLabel(p)}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="welfare_checks_enabled"
          defaultChecked={enabled}
          className="size-4 accent-gold"
        />
        Checks on
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

/** Create or edit a policy. */
export function PolicyForm({ values }: { values: PolicyValues }) {
  const [state, action, pending] = useActionState(
    values.id ? updateWelfarePolicy : createWelfarePolicy,
    null,
  );
  const [night, setNight] = useState(values.night_start !== null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="flex flex-col gap-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field
          label="Name"
          name="name"
          required
          maxLength={100}
          defaultValue={values.name}
          error={e?.name}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={values.enabled}
            className="size-4 accent-gold"
          />
          <span className="font-medium">Policy on</span>
          <span className="text-muted">(off = no checks at its sites)</span>
        </label>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">How often</h2>
        <p className="text-sm text-muted">
          Each check comes at a random time between the two intervals after the last one, so
          officers can’t predict it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Minimum interval (minutes)"
            name="min_interval_minutes"
            type="number"
            min={5}
            max={720}
            required
            defaultValue={values.min_interval_minutes}
            error={e?.min_interval_minutes}
          />
          <Field
            label="Maximum interval (minutes)"
            name="max_interval_minutes"
            type="number"
            min={5}
            max={720}
            required
            defaultValue={values.max_interval_minutes}
            error={e?.max_interval_minutes}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="night_enabled"
            checked={night}
            onChange={(ev) => setNight(ev.target.checked)}
            className="size-4 accent-gold"
          />
          <span className="font-medium">Different interval at night</span>
        </label>
        {night ? (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field
              label="Night starts"
              name="night_start"
              type="time"
              required
              defaultValue={values.night_start?.slice(0, 5) ?? '22:00'}
              error={e?.night_start}
            />
            <Field
              label="Night ends"
              name="night_end"
              type="time"
              required
              defaultValue={values.night_end?.slice(0, 5) ?? '06:00'}
              error={e?.night_end}
            />
            <Field
              label="Night minimum (min)"
              name="night_min_interval_minutes"
              type="number"
              min={5}
              max={720}
              required
              defaultValue={values.night_min_interval_minutes ?? 30}
              error={e?.night_min_interval_minutes}
            />
            <Field
              label="Night maximum (min)"
              name="night_max_interval_minutes"
              type="number"
              min={5}
              max={720}
              required
              defaultValue={values.night_max_interval_minutes ?? 50}
              error={e?.night_max_interval_minutes}
            />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">When nobody answers</h2>
        <p className="text-sm text-muted">
          Prompt on the phone → loud alarm → automated calls to the officer → push and SMS to
          on-duty supervisors and admins.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Time to answer (seconds)"
            name="response_seconds"
            type="number"
            min={15}
            max={900}
            required
            defaultValue={values.response_seconds}
            error={e?.response_seconds}
          />
          <Field
            label="Alarm before calling (seconds)"
            name="alarm_seconds"
            type="number"
            min={0}
            max={900}
            required
            defaultValue={values.alarm_seconds}
            error={e?.alarm_seconds}
          />
          <Field
            label="Automated calls to the officer"
            name="call_attempts"
            type="number"
            min={0}
            max={5}
            required
            defaultValue={values.call_attempts}
            error={e?.call_attempts}
          />
          <Field
            label="Gap between calls (seconds)"
            name="call_gap_seconds"
            type="number"
            min={30}
            max={900}
            required
            defaultValue={values.call_gap_seconds}
            error={e?.call_gap_seconds}
          />
          <Field
            label="Alert supervisors no later than (minutes, optional)"
            name="supervisor_alert_after_minutes"
            type="number"
            min={1}
            max={120}
            defaultValue={
              values.supervisor_alert_after_seconds === null
                ? ''
                : Math.round(values.supervisor_alert_after_seconds / 60)
            }
            error={e?.supervisor_alert_after_seconds}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : values.id ? 'Save policy' : 'Create policy'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DeletePolicyButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteWelfarePolicy, null);
  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (!window.confirm(`Delete the policy "${name}"? Past checks keep their timings.`)) {
          ev.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? 'Deleting…' : 'Delete policy'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
