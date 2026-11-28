'use client';

import { useActionState, useState } from 'react';

import { Button, Field, FormMessage, Select } from '@/components/ui';

import { createFormAssignment } from '../actions';

type Option = { value: string; label: string };

/** Assign to one officer, everyone at a site, or everyone with a role; optional due date. */
export function AssignForm({
  templateId,
  officers,
  sites,
}: {
  templateId: string;
  officers: Option[];
  sites: Option[];
}) {
  const [state, action, pending] = useActionState(createFormAssignment, null);
  const [target, setTarget] = useState<'officer' | 'site' | 'role'>('officer');
  const err = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="target" value={target} />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1.5 text-sm font-medium">Assign to</legend>
        {(
          [
            ['officer', 'An officer'],
            ['site', 'Everyone at a site'],
            ['role', 'Everyone with a role'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTarget(value)}
            className={`rounded-full border px-3 py-1.5 text-sm ${target === value ? 'border-gold bg-gold/20 font-medium' : 'border-line'}`}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        {target === 'officer' ? (
          <Select label="Officer" name="officer_id" required defaultValue="">
            <option value="" disabled>
              Choose an officer
            </option>
            {officers.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : target === 'site' ? (
          <Select label="Site" name="site_id" required defaultValue="">
            <option value="" disabled>
              Choose a site
            </option>
            {sites.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <Select label="Role" name="role" required defaultValue="officer">
            <option value="officer">Officers</option>
            <option value="supervisor">Supervisors</option>
            <option value="admin">Admins</option>
          </Select>
        )}
        <Field label="Due date (optional)" name="due_date" type="date" error={err.due_date} />
        <Field label="Due time" name="due_time" type="time" defaultValue="23:59" />
        <Button type="submit" disabled={pending}>
          {pending ? 'Assigning…' : 'Assign and notify'}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
