import Link from 'next/link';

type Tab = 'board' | 'reports' | 'policies';

/** Live board / Reports / Policies switcher at the top of the welfare pages. */
export function WelfareTabs({ current, isAdmin }: { current: Tab; isAdmin: boolean }) {
  const tabs: { key: Tab; href: string; label: string }[] = [
    { key: 'board', href: '/welfare', label: 'Live board' },
    { key: 'reports', href: '/welfare/reports', label: 'Reports' },
    ...(isAdmin
      ? [{ key: 'policies' as const, href: '/welfare/policies', label: 'Policies' }]
      : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-4">
      <h1 className="text-2xl font-bold">Welfare checks</h1>
      <nav className="flex gap-1 rounded-full bg-surface-2 p-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={current === t.key ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              current === t.key ? 'bg-surface shadow-sm' : 'text-muted hover:text-fg'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
