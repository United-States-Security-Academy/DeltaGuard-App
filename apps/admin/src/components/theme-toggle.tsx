'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';

import { MoonIcon, SunIcon } from './icons';
import { type Theme, THEME_STORAGE_KEY } from './theme';

function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** Same rule as THEME_SCRIPT: the saved choice, else the OS setting. */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage blocked: fall through to the OS setting.
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme, remember: boolean) {
  document.documentElement.setAttribute('data-theme', theme);
  if (!remember) return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode etc.: the choice just isn't remembered.
  }
}

/** Light / dark segmented switch, styled like the top bar's pill controls. */
export function ThemeToggle() {
  // null on the server: neither option shows as selected until hydrated.
  const theme = useSyncExternalStore(subscribe, readTheme, () => null);

  // In development, React's Strict Mode remount strips the attribute the head script set.
  useLayoutEffect(() => {
    if (!document.documentElement.hasAttribute('data-theme')) applyTheme(initialTheme(), false);
  }, []);

  const options: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
    { value: 'light', label: 'Light', Icon: SunIcon },
    { value: 'dark', label: 'Dark', Icon: MoonIcon },
  ];

  return (
    <div role="group" aria-label="Colour theme" className="flex rounded-full bg-surface-2 p-1">
      {options.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => applyTheme(value, true)}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-ink text-white shadow-sm dark:bg-gold dark:text-ink'
                : 'text-muted hover:text-fg'
            }`}
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
