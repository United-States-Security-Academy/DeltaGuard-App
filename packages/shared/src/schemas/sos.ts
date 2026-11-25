import { z } from 'zod';

// Mirrors the SOS functions' arguments and public.sos_contacts. The database
// re-checks everything.

export const sosNotesSchema = z.string().trim().max(2000, 'At most 2,000 characters');

/** Staff: acknowledge (notes optional). */
export const acknowledgeSosSchema = z.object({
  p_alert_id: z.uuid(),
  p_notes: sosNotesSchema.optional(),
});

/** Staff: resolve or close as a false alarm (notes required). */
export const resolveSosSchema = z.object({
  p_alert_id: z.uuid(),
  p_status: z.enum(['resolved', 'false_alarm'], 'Choose resolved or false alarm'),
  p_notes: sosNotesSchema.min(1, 'Add a note: what happened and what was done'),
});

/** Admins: an escalation contact. Phone in E.164 (+1 and 10 digits in the US). */
export const sosContactSchema = z.object({
  position: z.coerce.number().int().min(1, 'Order starts at 1').max(100),
  name: z.string().trim().min(1, 'Name is required').max(100),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s().-]/g, ''))
    .pipe(z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'Use international format, e.g. +12145550123')),
  user_id: z.uuid().nullable().optional(),
  active: z.boolean().default(true),
});
export type SosContactInput = z.infer<typeof sosContactSchema>;
