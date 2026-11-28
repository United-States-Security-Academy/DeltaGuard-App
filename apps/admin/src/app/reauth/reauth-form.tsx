'use client';

import { useActionState } from 'react';

import { Button, Field, FormMessage } from '@/components/ui';

import { reauthenticate } from './actions';

export function ReauthForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(reauthenticate, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm">
        This action changes who can do what, or exports personal data. Enter the current code from
        your authenticator app to continue.
      </p>
      <input type="hidden" name="next" value={next} />
      <Field
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Confirm'}
      </Button>
      <a href={next} className="text-center text-sm text-muted underline">
        Cancel
      </a>
    </form>
  );
}
