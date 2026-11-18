'use client';

import { useActionState } from 'react';

import { AuthCard, Button, Field, FormMessage } from '@/components/ui';

import { signIn } from './actions';

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState(
    signIn,
    notice ? { ok: false, message: notice } : null,
  );

  return (
    <AuthCard title="Sign in to DeltaGuard Admin">
      <form action={action} className="flex flex-col gap-4">
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          required
          error={state?.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={state?.fieldErrors?.password}
        />
        <FormMessage state={state?.fieldErrors ? null : state} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
