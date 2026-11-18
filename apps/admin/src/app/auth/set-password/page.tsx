'use client';

import { useActionState } from 'react';

import { AuthCard, Button, Field, FormMessage } from '@/components/ui';

import { setPassword } from './actions';

export default function SetPasswordPage() {
  const [state, action, pending] = useActionState(setPassword, null);

  if (state?.ok) {
    return (
      <AuthCard title="All set">
        <FormMessage state={state} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose your password">
      <form action={action} className="flex flex-col gap-4">
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          error={state?.fieldErrors?.password}
        />
        <Field
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={state?.fieldErrors?.confirm}
        />
        <FormMessage state={state?.fieldErrors ? null : state} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save password'}
        </Button>
      </form>
    </AuthCard>
  );
}
