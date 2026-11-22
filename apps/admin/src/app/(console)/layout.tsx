import { APP_NAME } from '@deltaguard/shared';
import Link from 'next/link';
import { Suspense } from 'react';

import { Button } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { MFA_REQUIRED } from '@/lib/mfa';

import { signOut } from '../actions';

export default function ConsoleLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex flex-1 flex-col">
      {MFA_REQUIRED ? null : (
        <p className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Two-factor sign-in is switched off (local development only). Remove ADMIN_SKIP_MFA from
          .env.local to turn it back on.
        </p>
      )}
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold">
            {APP_NAME} Admin
          </Link>
          <Suspense fallback={<div className="flex-1" />}>
            <Nav />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

async function Nav() {
  const staff = await requireStaff();
  return (
    <>
      <nav className="flex flex-1 gap-4 text-sm">
        <Link href="/" className="hover:underline">
          Dashboard
        </Link>
        <Link href="/schedule" className="hover:underline">
          Schedule
        </Link>
        <Link href="/officers" className="hover:underline">
          Officers
        </Link>
        <Link href="/clients" className="hover:underline">
          Clients
        </Link>
        <Link href="/sites" className="hover:underline">
          Sites
        </Link>
        <Link href="/incidents" className="hover:underline">
          Incidents
        </Link>
        <Link href="/timesheets" className="hover:underline">
          Timesheets
        </Link>
        {staff.role === 'admin' ? (
          <Link href="/users" className="hover:underline">
            Users
          </Link>
        ) : null}
      </nav>
      <span className="text-sm text-slate-500">
        {staff.email} · {staff.role}
      </span>
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </>
  );
}
