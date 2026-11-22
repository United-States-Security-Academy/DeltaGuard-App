// Dates for Postgres `date` columns ("YYYY-MM-DD"). These are calendar days,
// not instants, so all maths is done in UTC to avoid time-zone shifts.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar date on this device/server, as "YYYY-MM-DD". */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" shifted by a number of days. */
export function addDaysIso(dateIso: string, days: number): string {
  const t = Date.parse(`${dateIso}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "5 Jan 2026". */
export function formatDate(dateIso: string | null | undefined): string {
  if (!dateIso) return '—';
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Licence expiry ---------------------------------------------------------------

/** Windows used by the admin filters and the mobile warning. */
export const EXPIRY_WINDOWS = [30, 60] as const;
export type ExpiryWindow = (typeof EXPIRY_WINDOWS)[number];

export type ExpiryStatus =
  | { kind: 'none' } // no expiry date recorded
  | { kind: 'expired'; days: number } // days since it expired
  | { kind: 'expiring'; days: number } // days left, within 30
  | { kind: 'valid'; days: number }; // days left, more than 30

export function expiryStatus(expiresOn: string | null, today: string = todayIso()): ExpiryStatus {
  if (!expiresOn) return { kind: 'none' };
  const days = daysBetween(today, expiresOn);
  if (days < 0) return { kind: 'expired', days: -days };
  if (days <= 30) return { kind: 'expiring', days };
  return { kind: 'valid', days };
}

/** "Expired 3 days ago", "Expires today", "Expires in 12 days". */
export function describeExpiry(status: ExpiryStatus): string {
  const plural = (n: number) => (n === 1 ? 'day' : 'days');
  switch (status.kind) {
    case 'none':
      return 'No expiry date';
    case 'expired':
      return `Expired ${status.days} ${plural(status.days)} ago`;
    case 'expiring':
    case 'valid':
      return status.days === 0
        ? 'Expires today'
        : `Expires in ${status.days} ${plural(status.days)}`;
  }
}
