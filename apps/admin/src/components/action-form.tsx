'use client';

import { type ReactNode, useActionState } from 'react';

import type { ActionState } from '@/lib/action-state';

import { Button, FormMessage, Select } from './ui';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * A single-button form for a server action (delete, unassign…), with hidden
 * fields, an optional confirmation prompt and the action's result message.
 */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  confirm,
  variant = 'secondary',
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? (pendingLabel ?? `${label}…`) : label}
      </Button>
      {state && !state.ok ? <FormMessage state={state} /> : null}
    </form>
  );
}

/** "Pick one and submit" form, e.g. assign an officer to a site. */
export function PickForm({
  action,
  fields,
  name,
  label,
  placeholder,
  options,
  submitLabel,
}: {
  action: Action;
  fields: Record<string, string>;
  name: string;
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  submitLabel: string;
}): ReactNode {
  const [state, formAction, pending] = useActionState(action, null);
  if (options.length === 0) return null;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <Select label={label} name={name} required defaultValue="">
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
