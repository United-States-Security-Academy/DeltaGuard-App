import { Suspense } from 'react';

import { AuthCard } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { MFA_REQUIRED } from '@/lib/mfa';
import { safeNext } from '@/lib/safe-next';

import { ReauthForm } from './reauth-form';

export default function ReauthPage({ searchParams }: PageProps<'/reauth'>) {
  return (
    <AuthCard title="Confirm it’s you">
      <Suspense fallback={null}>
        <Reauth searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Reauth({ searchParams }: { searchParams: PageProps<'/reauth'>['searchParams'] }) {
  await requireStaff();
  const next = safeNext((await searchParams).next);
  if (!MFA_REQUIRED) {
    return (
      <p className="text-sm">
        Two-factor sign-in is switched off (local development).{' '}
        <a href={next} className="underline">
          Continue
        </a>
      </p>
    );
  }
  return <ReauthForm next={next} />;
}
