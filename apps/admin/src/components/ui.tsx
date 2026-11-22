import type { ComponentProps, ReactNode } from 'react';

// Minimal shared building blocks so forms look consistent.

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 p-6 shadow-sm dark:border-slate-800">
        <h1 className="mb-6 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Field({
  label,
  error,
  ...props
}: ComponentProps<'input'> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-slate-900 dark:border-slate-700 dark:focus:border-slate-200"
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error ? <span className="text-red-600 dark:text-red-400">{error}</span> : null}
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: ComponentProps<'select'> & { label?: string; children: ReactNode }) {
  const select = (
    <select
      className="rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
      {...props}
    >
      {children}
    </select>
  );
  if (!label) return select;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {select}
    </label>
  );
}

const buttonStyles = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200',
  secondary:
    'border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-500',
} as const;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function FormMessage({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state?.message) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={`text-sm ${state.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {state.message}
    </p>
  );
}

export function Textarea({
  label,
  error,
  ...props
}: ComponentProps<'textarea'> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        className="min-h-24 rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-slate-900 dark:border-slate-700 dark:focus:border-slate-200"
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error ? <span className="text-red-600 dark:text-red-400">{error}</span> : null}
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const badgeTones = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
} as const;
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
      {children}
    </p>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-red-600 dark:text-red-400">{children}</p>;
}

/** Table wrapper with the console's standard styling. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-slate-200 dark:[&>tr]:border-slate-800">
          {children}
        </tbody>
      </table>
    </div>
  );
}
