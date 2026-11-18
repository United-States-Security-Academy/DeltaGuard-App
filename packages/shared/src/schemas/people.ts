import { z } from 'zod';

import { LICENSE_FILE_MAX_BYTES, LICENSE_FILE_MIME_TYPES } from '../constants';
import { isoDateSchema, optionalText } from './common';
import { fullNameSchema, phoneSchema } from './user';

// Mirrors the CHECK constraints on public.officer_details / public.qualifications.

export const emergencyContactSchema = z.object({
  name: fullNameSchema,
  relationship: z.string().trim().max(100).optional(),
  phone: phoneSchema,
});
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

/** Admin-only: create or update an officer's HR details. */
export const officerDetailsSchema = z.object({
  user_id: z.uuid(),
  employee_number: optionalText(50),
  address: optionalText(500),
  emergency_contact: emergencyContactSchema.nullable(),
  date_hired: isoDateSchema.nullable(),
});
export type OfficerDetailsInput = z.infer<typeof officerDetailsSchema>;

/** Admin-only: a license or certificate. */
export const qualificationSchema = z
  .object({
    user_id: z.uuid(),
    type: z.string().trim().min(1, 'Type is required').max(100),
    license_number: optionalText(100),
    issued_on: isoDateSchema.nullable(),
    expires_on: isoDateSchema.nullable(),
    document_path: z.string().max(500).nullable(),
  })
  .refine((q) => !q.issued_on || !q.expires_on || q.expires_on >= q.issued_on, {
    message: 'Expiry must be on or after the issue date',
    path: ['expires_on'],
  })
  .refine((q) => !q.document_path || q.document_path.startsWith(`${q.user_id}/`), {
    message: "The file must be stored in the officer's own folder",
    path: ['document_path'],
  });
export type QualificationInput = z.infer<typeof qualificationSchema>;

/** A license scan before upload (checked again by the bucket's own limits). */
export const licenseFileSchema = z.object({
  size: z.number().int().positive().max(LICENSE_FILE_MAX_BYTES, 'File must be 10 MB or smaller'),
  type: z.enum(LICENSE_FILE_MIME_TYPES, 'Upload a JPEG, PNG, HEIC, WebP or PDF'),
});
