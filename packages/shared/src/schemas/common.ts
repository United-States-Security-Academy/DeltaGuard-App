import { z } from 'zod';

/** Optional free text: trimmed, length-capped, and "" stored as null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** "YYYY-MM-DD", the format Postgres `date` columns use. */
export const isoDateSchema = z.iso.date('Use the format YYYY-MM-DD');

/** Any action that targets one row by id. */
export const recordIdSchema = z.object({ id: z.uuid() });

/** URL search params can repeat (?a=1&a=2); take the first value. */
export const firstParam = (value: unknown) => (Array.isArray(value) ? value[0] : value);
