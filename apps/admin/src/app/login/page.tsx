import { Suspense } from 'react';

import { LoginForm } from './login-form';

const NOTICES: Record<string, string> = {
  not_allowed:
    'You were signed out: this account does not have access to the admin console. Officers use the DeltaGuard mobile app.',
  link_invalid: 'That link is invalid or has expired. Ask an admin to send a new invite.',
};

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <Suspense>
      <LoginWithNotice searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginWithNotice({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const { error } = await searchParams;
  const notice = typeof error === 'string' ? NOTICES[error] : undefined;
  return <LoginForm notice={notice} />;
}
