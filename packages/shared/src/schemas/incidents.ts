import { z } from 'zod';

import {
  INCIDENT_CATEGORIES,
  INCIDENT_MAX_PHOTOS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
} from '../constants';

// Mirrors public.incidents and the submit_incident() / review_incident()
// arguments. The database re-checks everything.

export const incidentCategorySchema = z.enum(INCIDENT_CATEGORIES, 'Choose a category');
export const incidentSeveritySchema = z.enum(INCIDENT_SEVERITIES, 'Choose a severity');
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);

/** What the officer fills in (mobile form). */
export const incidentFormSchema = z.object({
  site_id: z.uuid('Choose a site'),
  shift_id: z.uuid().nullable(),
  occurred_at: z.iso
    .datetime({ offset: true, message: 'Enter when it happened' })
    .refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, 'This time is in the future')
    .refine(
      (v) => Date.parse(v) >= Date.now() - 30 * 24 * 60 * 60_000,
      'More than 30 days ago: tell your supervisor instead',
    ),
  category: incidentCategorySchema,
  severity: incidentSeveritySchema,
  description: z.string().trim().min(1, 'Describe what happened').max(10000),
  people_involved: z.string().trim().max(4000),
  police_called: z.boolean(),
});
export type IncidentFormInput = z.infer<typeof incidentFormSchema>;

/** Arguments of submit_incident(). */
export const submitIncidentSchema = z.object({
  p_id: z.uuid(),
  p_site_id: z.uuid(),
  p_shift_id: z.uuid().nullable(),
  p_occurred_at: z.iso.datetime({ offset: true }),
  p_category: incidentCategorySchema,
  p_severity: incidentSeveritySchema,
  p_description: z.string().trim().min(1).max(10000),
  p_people_involved: z.string().trim().max(4000).nullable(),
  p_police_called: z.boolean(),
  p_photo_paths: z.array(z.string().min(1).max(300)).max(INCIDENT_MAX_PHOTOS),
});
export type SubmitIncidentInput = z.infer<typeof submitIncidentSchema>;

/** Admins and supervisors: review_incident(). */
export const reviewIncidentSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['under_review', 'approved', 'returned']),
    notes: z.string().trim().max(4000),
  })
  .refine((r) => r.status !== 'returned' || r.notes !== '', {
    message: 'Say what the officer needs to change',
    path: ['notes'],
  });
export type ReviewIncidentInput = z.infer<typeof reviewIncidentSchema>;
