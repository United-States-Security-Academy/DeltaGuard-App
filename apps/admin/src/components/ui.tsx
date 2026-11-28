import Image from 'next/image';
import type { ComponentProps, ReactNode } from 'react';

// Shared building blocks so every console page has the same look
// (Deltacon palette; light and dark themes via the tokens in globals.css).

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm panel p-7">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image src="/logo.png" alt="Deltacon Security" width={64} height={80} priority />
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

const inputStyles =
  'rounded-xl border border-line bg-surface px-3 py-2 outline-none transition-shadow placeholder:text-muted focus:border-gold focus:ring-2 focus:ring-gold/30 aria-invalid:border-red-500';

export function Field({
  label,
  error,
  ...props
}: ComponentProps<'input'> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input className={inputStyles} aria-invalid={error ? true : undefined} {...props} />
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
      className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
      {...props}
    >
      {children}
    </select>
  );
  if (!label) return select;
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {select}
    </label>
  );
}

const buttonStyles = {
  primary:
    'bg-ink text-white hover:bg-navy dark:bg-gold dark:text-ink dark:hover:bg-gold/85 shadow-sm',
  secondary: 'border border-line bg-surface hover:bg-surface-2',
  danger: 'bg-red-600 text-white hover:bg-red-500',
} as const;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function FormMessage({
  state,
}: {
  state: { ok: boolean; message: string; reauthUrl?: string } | null;
}) {
  if (!state?.message) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={`text-sm ${state.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {state.message}
      {state.reauthUrl ? (
        <>
          {' '}
          <a href={state.reauthUrl} className="font-semibold underline">
            Enter your code
          </a>
        </>
      ) : null}
    </p>
  );
}

export function Textarea({
  label,
  error,
  ...props
}: ComponentProps<'textarea'> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        className={`min-h-24 ${inputStyles}`}
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
    <section className="panel p-5 sm:p-6">
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const badgeTones = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  good: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  bad: 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300',
} as const;
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-3xl border border-dashed border-slate-300 bg-surface/60 p-8 text-center text-sm text-muted dark:border-slate-700">
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
    <div className="overflow-x-auto panel px-2 py-1 sm:px-3">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-3 text-xs font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-line">{children}</tbody>
      </table>
    </div>
  );
}

function initials(name: string): string {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Initials in a navy circle with a gold ring (no photos are stored for staff). */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'size-7 text-[0.65rem]', md: 'size-9 text-xs', lg: 'size-16 text-lg' };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-navy font-semibold text-gold ring-2 ring-gold/50 ${sizes[size]}`}
    >
      {initials(name)}
    </span>
  );
}
