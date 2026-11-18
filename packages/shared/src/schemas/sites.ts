import { z } from 'zod';

import { DEFAULT_CLOCK_IN_RADIUS_M } from '../constants';
import { emailSchema } from './admin';
import { optionalText } from './common';
import { fullNameSchema, phoneSchema } from './user';

// Mirrors the CHECK constraints on public.clients / public.sites.

/** Admin-only: create or update a client. */
export const clientSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  contact_person: optionalText(200),
  phone: phoneSchema.nullable(),
  email: emailSchema.nullable(),
  notes: optionalText(5000),
});
export type ClientInput = z.infer<typeof clientSchema>;

export const siteContactSchema = z.object({
  name: fullNameSchema,
  role: z.string().trim().max(100).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
});
export type SiteContact = z.infer<typeof siteContactSchema>;

/** Fields admins and supervisors may edit on a site. */
export const siteDetailsSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    address: optionalText(500),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    clock_in_radius_m: z.number().int().min(25).max(5000).default(DEFAULT_CLOCK_IN_RADIUS_M),
    emergency_instructions: optionalText(10000),
    site_contacts: z.array(siteContactSchema).max(50).default([]),
    active: z.boolean().default(true),
  })
  .refine((s) => (s.latitude === null) === (s.longitude === null), {
    message: 'Enter both latitude and longitude, or neither',
    path: ['longitude'],
  });
export type SiteDetailsInput = z.infer<typeof siteDetailsSchema>;

/** Admin-only: create a site (choosing its client). */
export const siteCreateSchema = z.object({ client_id: z.uuid() }).and(siteDetailsSchema);
export type SiteCreateInput = z.infer<typeof siteCreateSchema>;

/** Admin-only: assign or unassign an officer. */
export const siteAssignmentSchema = z.object({
  site_id: z.uuid(),
  officer_id: z.uuid(),
});
export type SiteAssignmentInput = z.infer<typeof siteAssignmentSchema>;
