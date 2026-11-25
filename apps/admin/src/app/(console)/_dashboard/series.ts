// Shared by the server-rendered cards and the client-side charts. Kept out of
// charts.tsx ('use client'): a server component importing a value from a client
// module gets a client reference, not the value.

// Colours are the --chart-* tokens in globals.css: validated for colour-blind
// separation and 3:1 contrast in both themes, and they follow the theme switch.
export const ATTENDANCE_SERIES = [
  { key: 'on_time', label: 'On time', color: 'var(--chart-1)' },
  { key: 'late', label: 'Late', color: 'var(--chart-2)' },
  { key: 'missed', label: 'Missed', color: 'var(--chart-3)' },
] as const;
