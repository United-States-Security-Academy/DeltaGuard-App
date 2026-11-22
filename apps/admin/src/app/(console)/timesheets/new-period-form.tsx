'use client';

import { addDaysIso } from '@deltaguard/shared';
import { useActionState } from 'react';

import { Button, Field, FormMessage } from '@/components/ui';

import { createPayPeriod } from './actions';

/** Admin: add a pay period. Defaults to two weeks after the latest one. */
export function NewPeriodForm({ suggestedStart }: { suggestedStart?: string }) {
  const [state, action, pending] = useActionState(createPayPeriod, null);
  const err = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field
        label="First day"
        name="starts_on"
        type="date"
        required
        defaultValue={suggestedStart}
        error={err.starts_on}
      />
      <Field
        label="Last day"
        name="ends_on"
        type="date"
        required
        defaultValue={suggestedStart ? addDaysIso(suggestedStart, 13) : undefined}
        error={err.ends_on}
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create pay period'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
