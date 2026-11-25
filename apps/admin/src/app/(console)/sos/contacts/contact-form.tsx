'use client';

import { useActionState } from 'react';

import { Button, Field, FormMessage, Select } from '@/components/ui';
import type { ActionState } from '@/lib/action-state';

export function ContactForm({
  action,
  nextPosition,
  people,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  nextPosition: number;
  people: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const err = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-[6rem_1fr_1fr]">
      <Field
        label="Order"
        name="position"
        type="number"
        min={1}
        max={100}
        defaultValue={nextPosition}
        error={err.position}
        required
      />
      <Field label="Name" name="name" maxLength={100} error={err.name} required />
      <Field
        label="Mobile (for SMS)"
        name="phone"
        type="tel"
        placeholder="+12145550123"
        error={err.phone}
        required
      />
      <div className="sm:col-span-3">
        <Select
          label="Their Deltacon Guard account (optional: they also get the push)"
          name="user_id"
          defaultValue=""
        >
          <option value="">No account</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add contact'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
