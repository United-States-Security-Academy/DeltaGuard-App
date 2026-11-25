import { authLinkParamsSchema } from '@deltaguard/shared';
import { Suspense } from 'react';

import { AuthCard } from '@/components/ui';

// The invite email links here instead of straight to /auth/confirm, because:
//  - officers should finish in the mobile app, staff in the browser, and the
//    token alone doesn't say which role the person has;
//  - email security scanners "click" links. Showing a page first (rather than
//    verifying on GET) stops a scanner from using up the one-time token.
// MOBILE_APP_LINK_BASE is the app's deep link prefix: deltaguard:// for a
// development/production build, or exp://<your-PC-LAN-IP>:8081/--/ for Expo Go.

export default function AcceptInvitePage({ searchParams }: PageProps<'/auth/accept'>) {
  return (
    <Suspense>
      <AcceptInvite searchParams={searchParams} />
    </Suspense>
  );
}

async function AcceptInvite({ searchParams }: Pick<PageProps<'/auth/accept'>, 'searchParams'>) {
  const parsed = authLinkParamsSchema.safeParse(await searchParams);
  if (!parsed.success) {
    return (
      <AuthCard title="Invalid link">
        <p className="text-sm">
          This link is incomplete. Open the invite email again, or ask an admin to resend it.
        </p>
      </AuthCard>
    );
  }

  const query = new URLSearchParams(parsed.data).toString();
  const appBase = process.env.MOBILE_APP_LINK_BASE || 'deltaguard://';
  const appLink = `${appBase}set-password?${query}`;
  const browserLink = `/auth/confirm?${query}`;

  return (
    <AuthCard title="Welcome to Deltacon Guard">
      <div className="flex flex-col gap-4 text-sm">
        <p>Choose where to set your password.</p>
        <a
          href={appLink}
          className="rounded-lg bg-slate-900 px-3 py-3 text-center font-medium text-white dark:bg-white dark:text-slate-900"
        >
          Officers: open the Deltacon Guard app
        </a>
        <p className="text-slate-500">
          Open this page on your phone with the Deltacon Guard app installed.
        </p>
        <a
          href={browserLink}
          className="rounded-lg border border-slate-300 px-3 py-3 text-center font-medium dark:border-slate-700"
        >
          Admins and supervisors: continue in browser
        </a>
      </div>
    </AuthCard>
  );
}
