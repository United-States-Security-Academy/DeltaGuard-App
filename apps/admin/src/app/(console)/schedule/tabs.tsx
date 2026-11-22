import Link from 'next/link';

/** Week / Today switcher shown at the top of the schedule pages. */
export function ScheduleTabs({ current }: { current: 'week' | 'today' }) {
  const tab = (key: 'week' | 'today', href: string, label: string) => (
    <Link
      href={href}
      aria-current={current === key ? 'page' : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        current === key
          ? 'bg-white shadow-sm dark:bg-slate-700'
          : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {tab('week', '/schedule', 'Week')}
          {tab('today', '/schedule/today', 'Today')}
        </nav>
      </div>
      <Link
        href="/schedule/new"
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
      >
        Add shift
      </Link>
    </div>
  );
}
