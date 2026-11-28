// Plain module (server and client): how answers and dates read in the console.

import { formatDate, type FormFieldType, toZoned } from '@deltaguard/shared';

/** An officer's answer as text: dates as MM/DD/YYYY (US), checkboxes as Yes/No. */
export function formatAnswer(type: FormFieldType, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (type === 'checkbox') return value === true ? 'Yes' : 'No';
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

export function formatWhen(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  const z = toZoned(iso, timeZone);
  return `${formatDate(z.date)} ${z.time}`;
}
