'use client';

import { type ComponentProps, useState } from 'react';

import { EyeIcon, EyeOffIcon } from './icons';

/** A password input with an eye button to show what was typed (hidden by default). */
export function PasswordField({
  label,
  error,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { label: string; error?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <span className="relative flex">
        <input
          type={visible ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-xl border border-line bg-surface py-2 pr-11 pl-3 transition-shadow outline-none placeholder:text-muted focus:border-gold focus:ring-2 focus:ring-gold/30 aria-invalid:border-red-500"
          aria-invalid={error ? true : undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-1 my-auto flex size-9 items-center justify-center rounded-lg text-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:outline-none"
        >
          {visible ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
        </button>
      </span>
      {error ? <span className="text-red-600 dark:text-red-400">{error}</span> : null}
    </label>
  );
}
