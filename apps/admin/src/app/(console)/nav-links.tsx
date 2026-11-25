'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  CalendarIcon,
  ClientsIcon,
  DashboardIcon,
  IncidentsIcon,
  LiveIcon,
  MessagesIcon,
  OfficersIcon,
  SettingsIcon,
  SitesIcon,
  SosIcon,
  TimesheetsIcon,
  UsersIcon,
} from '@/components/icons';

const ICONS = {
  dashboard: DashboardIcon,
  live: LiveIcon,
  schedule: CalendarIcon,
  officers: OfficersIcon,
  clients: ClientsIcon,
  sites: SitesIcon,
  incidents: IncidentsIcon,
  timesheets: TimesheetsIcon,
  users: UsersIcon,
  messages: MessagesIcon,
  sos: SosIcon,
  settings: SettingsIcon,
} as const;

export type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Small count pill, e.g. incidents waiting for review. */
  badge?: number;
};

/** The item whose href is the longest prefix of the current path is active. */
function activeHref(pathname: string, items: NavItem[]): string | undefined {
  return items
    .filter((i) =>
      i.href === '/' ? pathname === '/' : pathname === i.href || pathname.startsWith(`${i.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function NavLinks({ items, layout }: { items: NavItem[]; layout: 'sidebar' | 'bar' }) {
  const pathname = usePathname();
  const current = activeHref(pathname, items);

  if (layout === 'bar') {
    return (
      <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {items.map((item) => {
          const active = item.href === current;
          const Icon = ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                active ? 'bg-ink text-white dark:bg-gold dark:text-ink' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon className="size-4" />
              {item.label}
              {item.badge ? <CountPill count={item.badge} active={active} /> : null}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.href === current;
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`group flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-ink text-white shadow-sm dark:bg-surface-2 dark:text-white'
                : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            <Icon
              className={`size-[1.15rem] shrink-0 ${active ? 'text-gold' : 'text-muted group-hover:text-fg'}`}
            />
            <span className="flex-1">{item.label}</span>
            {item.badge ? <CountPill count={item.badge} active={active} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function CountPill({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${
        active ? 'bg-gold text-ink' : 'bg-gold/25 text-accent-ink'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
