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
