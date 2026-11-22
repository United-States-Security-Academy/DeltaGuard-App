import { z } from 'zod';

import { DAR_ENTRY_TYPES } from '../constants';

// Mirrors the CHECK constraints on public.post_orders and public.dar_entries.

/** Admins and supervisors: create or edit a post order (saving publishes a new version). */
export const postOrderSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  body: z.string().trim().min(1, 'Write the instructions').max(20000, 'At most 20,000 characters'),
});
export type PostOrderInput = z.infer<typeof postOrderSchema>;

export const acknowledgePostOrderSchema = z.object({
  p_post_order_id: z.uuid(),
  p_version: z.number().int().min(1),
});
export type AcknowledgePostOrderInput = z.infer<typeof acknowledgePostOrderSchema>;

export const darEntryTypeSchema = z.enum(DAR_ENTRY_TYPES);

/** Officer: a line in their daily activity report. */
export const darEntrySchema = z.object({
  report_id: z.uuid(),
  type: darEntryTypeSchema,
  description: z.string().trim().min(1, 'Describe what happened').max(4000),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
  photo_path: z.string().max(300).nullable().optional(),
});
export type DarEntryInput = z.infer<typeof darEntrySchema>;
