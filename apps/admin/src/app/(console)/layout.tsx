import { APP_NAME, formatDate, todayInZone } from '@deltaguard/shared';
import Form from 'next/form';
import Image from 'next/image';
import Link from 'next/link';
import { cache, Suspense } from 'react';

import { SearchIcon, SignOutIcon } from '@/components/icons';
import { SosWatcher } from '@/components/sos-watcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { MFA_REQUIRED } from '@/lib/mfa';
import { createClient } from '@/lib/supabase/server';

import { signOut } from '../actions';
import { type NavItem, NavLinks } from './nav-links';
import { getTimeZone } from './schedule/data';

export default function ConsoleLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex flex-1 flex-col">
      {MFA_REQUIRED ? null : (
        <p className="bg-gold/20 px-4 py-1.5 text-center text-xs text-accent-ink">
          Two-factor sign-in is switched off (local development only). Remove ADMIN_SKIP_MFA from
          .env.local to turn it back on.
        </p>
      )}
      <div className="flex flex-1 gap-5 p-3 sm:p-5">
        <aside className="sticky top-5 hidden h-[calc(100dvh-2.5rem)] w-64 shrink-0 flex-col panel p-4 lg:flex">
          <Brand />
          <Suspense fallback={<NavSkeleton />}>
            <Sidebar />
          </Suspense>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <header className="flex flex-col gap-3 panel px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <Link href="/" className="lg:hidden" aria-label={`${APP_NAME} dashboard`}>
                <Image src="/logo.png" alt="" width={36} height={45} className="h-9 w-auto" />
              </Link>
              <Form action="/officers" className="relative max-w-sm flex-1">
                <label htmlFor="console-search" className="sr-only">
                  Search officers
                </label>
                <input
                  id="console-search"
                  name="q"
                  type="search"
                  placeholder="Search officers"
                  className="w-full rounded-full bg-surface-2 py-2.5 pr-10 pl-4 text-sm outline-none placeholder:text-muted focus:ring-2 focus:ring-gold/60"
                />
                <SearchIcon className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted" />
              </Form>
              <Suspense fallback={null}>
                <TodayLabel />
              </Suspense>
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle />
                <form action={signOut} className="lg:hidden">
                  <button
                    type="submit"
                    aria-label="Sign out"
                    className="rounded-full bg-surface-2 p-2.5 text-muted hover:text-fg"
                  >
                    <SignOutIcon className="size-4" />
                  </button>
                </form>
              </div>
            </div>
            <div className="lg:hidden">
              <Suspense fallback={null}>
                <MobileNav />
              </Suspense>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          {/* Full-screen alarm for an unacknowledged SOS, on every page. */}
          <Suspense fallback={null}>
            <StaffOnly>
              <SosWatcher />
            </StaffOnly>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="mb-6 flex shrink-0 items-center gap-3 px-2 pt-1">
      <Image src="/logo.png" alt="" width={40} height={50} className="h-11 w-auto" priority />
      <span className="leading-tight">
        <span className="block font-bold tracking-wide">{APP_NAME}</span>
        <span className="block text-xs text-muted">Deltacon Security</span>
      </span>
    </Link>
  );
}

/** Nav items for this staff member, with the review count on Incidents. Once per request. */
const navItems = cache(
  async (): Promise<{
    items: NavItem[];
    staff: Awaited<ReturnType<typeof requireStaff>>;
    name: string | null;
  }> => {
    const staff = await requireStaff();
    const supabase = await createClient();
    const [waiting, profile, chats, openSos] = await Promise.all([
      supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .in('status', ['submitted', 'under_review']),
      supabase.from('profiles').select('full_name').eq('id', staff.userId).maybeSingle(),
      supabase.rpc('list_conversations'),
      supabase
        .from('sos_alerts')
        .select('id', { count: 'exact', head: true })
        .in('status', ['active', 'acknowledged']),
    ]);
    const unreadMessages = (chats.data ?? []).reduce((n, c) => n + c.unread_count, 0);

    const items: NavItem[] = [
      { href: '/', label: 'Dashboard', icon: 'dashboard' },
      { href: '/sos', label: 'SOS', icon: 'sos', badge: openSos.count ?? 0 },
      { href: '/schedule/today', label: 'Live board', icon: 'live' },
      { href: '/schedule', label: 'Schedule', icon: 'schedule' },
      { href: '/officers', label: 'Officers', icon: 'officers' },
      { href: '/clients', label: 'Clients', icon: 'clients' },
      { href: '/sites', label: 'Sites', icon: 'sites' },
      { href: '/incidents', label: 'Incidents', icon: 'incidents', badge: waiting.count ?? 0 },
      { href: '/timesheets', label: 'Timesheets', icon: 'timesheets' },
      { href: '/messages', label: 'Messages', icon: 'messages', badge: unreadMessages },
    ];
    if (staff.role === 'admin') {
      items.push(
        { href: '/users', label: 'Users', icon: 'users' },
        { href: '/settings', label: 'Settings', icon: 'settings' },
      );
    }
    return { items, staff, name: profile.data?.full_name ?? null };
  },
);

async function Sidebar() {
  const { items, staff, name } = await navItems();
  const displayName = name || staff.email || 'Signed in';
  return (
    <>
      {/* The nav scrolls on short screens so the profile card stays inside the panel. */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <NavLinks items={items} layout="sidebar" />
      </div>
      <div className="mt-4 flex shrink-0 items-center gap-3 rounded-2xl bg-surface-2 p-3">
        <Avatar name={displayName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={displayName}>
            {displayName}
          </p>
          <span className="mt-0.5 inline-block rounded-full bg-gold/25 px-2 py-0.5 text-[0.7rem] font-medium text-accent-ink capitalize">
            {staff.role}
          </span>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="rounded-full p-2 text-muted transition-colors hover:bg-surface hover:text-fg"
          >
            <SignOutIcon className="size-4" />
          </button>
        </form>
      </div>
    </>
  );
}

async function MobileNav() {
  const { items } = await navItems();
  return <NavLinks items={items} layout="bar" />;
}

/** Today's date in the company time zone, like the concept's date chip. */
async function TodayLabel() {
  await requireStaff();
  const supabase = await createClient();
  const timeZone = await getTimeZone(supabase);
  return (
    <span className="hidden text-sm whitespace-nowrap text-muted md:inline">
      {formatDate(todayInZone(timeZone, new Date()))}
    </span>
  );
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-2xl bg-surface-2" />
      ))}
    </div>
  );
}

/** Renders its children only for signed-in staff (the console layout itself is static). */
async function StaffOnly({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <>{children}</>;
}
