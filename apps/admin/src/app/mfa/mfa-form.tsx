'use client';

import { totpCodeSchema } from '@deltaguard/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { AuthCard, Button, Field, FormMessage } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

import { signOut } from '../actions';

type Step =
  | { kind: 'loading' }
  | { kind: 'enroll'; factorId: string; qrCode: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; message: string };

// MFA runs in the browser: Supabase upgrades the session to aal2 when the
// code is verified, and the browser client writes the new session cookie.
export function MfaForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // React runs effects twice in development; enroll only once.
    if (started.current) return;
    started.current = true;

    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setStep({ kind: 'error', message: error.message });

      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) return setStep({ kind: 'verify', factorId: verified.id });

      // Clear half-finished enrollments from earlier attempts.
      for (const f of data.all.filter(
        (f) => f.factor_type === 'totp' && f.status === 'unverified',
      )) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      const enrolled = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'DeltaGuard Admin',
      });
      if (enrolled.error) return setStep({ kind: 'error', message: enrolled.error.message });
      setStep({
        kind: 'enroll',
        factorId: enrolled.data.id,
        qrCode: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      });
    })();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind !== 'enroll' && step.kind !== 'verify') return;

    const code = totpCodeSchema.safeParse(new FormData(event.currentTarget).get('code'));
    if (!code.success) return setMessage({ ok: false, message: code.error.issues[0]!.message });

    setPending(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId: step.factorId,
      code: code.data,
    });
    setPending(false);
    if (error)
      return setMessage({ ok: false, message: 'That code did not work. Try the next one.' });

    router.replace('/');
    router.refresh();
  }

  const signOutButton = (
    <form action={signOut} className="mt-4">
      <Button type="submit" variant="secondary" className="w-full">
        Sign out
      </Button>
    </form>
  );

  if (step.kind === 'loading') {
    return <AuthCard title="Two-factor authentication">Loading…</AuthCard>;
  }

  if (step.kind === 'error') {
    return (
      <AuthCard title="Two-factor authentication">
        <FormMessage state={{ ok: false, message: step.message }} />
        {signOutButton}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={step.kind === 'enroll' ? 'Set up two-factor authentication' : 'Enter your code'}
    >
      {step.kind === 'enroll' ? (
        <div className="mb-4 flex flex-col gap-3 text-sm">
          <p>
            Admins and supervisors must use an authenticator app (Google Authenticator, Microsoft
            Authenticator, 1Password…). Scan this QR code, then enter the 6-digit code.
          </p>
          {/* The QR code is an SVG data URL from Supabase, so next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={step.qrCode}
            alt="QR code for your authenticator app"
            className="mx-auto size-48 rounded-lg bg-white p-2"
          />
          <p className="text-slate-500">
            Can&apos;t scan? Enter this key manually:{' '}
            <code className="font-mono break-all">{step.secret}</code>
          </p>
        </div>
      ) : (
        <p className="mb-4 text-sm">Open your authenticator app and enter the current code.</p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
        <FormMessage state={message} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Verify'}
        </Button>
      </form>
      {signOutButton}
    </AuthCard>
  );
}
