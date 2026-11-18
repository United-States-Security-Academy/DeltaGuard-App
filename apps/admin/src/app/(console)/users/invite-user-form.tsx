'use client';

import { USER_ROLES } from '@deltaguard/shared';
import { useActionState, useEffect, useRef } from 'react';

import { Button, Field, FormMessage, Select } from '@/components/ui';

import { inviteUser } from './actions';

export function InviteUserForm() {
  const [state, action, pending] = useActionState(inviteUser, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-4 font-semibold">Invite user</h2>
      <form
        ref={formRef}
        action={action}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <Field label="Full name" name="full_name" required error={state?.fieldErrors?.full_name} />
        <Field label="Email" name="email" type="email" required error={state?.fieldErrors?.email} />
        <Field
          label="Phone (optional)"
          name="phone"
          type="tel"
          placeholder="+2348012345678"
          error={state?.fieldErrors?.phone}
        />
        <Select label="Role" name="role" defaultValue="officer">
          {USER_ROLES.map((role) => (
            <option key={role} value={role} className="capitalize">
              {role}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
      </form>
      <div className="mt-3">
        <FormMessage state={state?.fieldErrors ? null : state} />
      </div>
    </section>
  );
}
