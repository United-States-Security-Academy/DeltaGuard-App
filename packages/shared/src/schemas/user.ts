import { z } from 'zod';

import { DEVICE_PLATFORMS, EMPLOYMENT_STATUSES, USER_ROLES } from '../constants';

export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const employmentStatusSchema = z.enum(EMPLOYMENT_STATUSES);
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;

export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

// Mirrors the CHECK constraints on public.profiles.
export const fullNameSchema = z.string().trim().min(1, 'Name is required').max(200);
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, 'Use international format, e.g. +2348012345678');

/** Fields any user may change on their own profile. */
export const ownProfileUpdateSchema = z
  .object({
    full_name: fullNameSchema,
    phone: phoneSchema.nullable(),
  })
  .partial();
export type OwnProfileUpdate = z.infer<typeof ownProfileUpdateSchema>;

/** Fields only admins may change. */
export const adminProfileUpdateSchema = ownProfileUpdateSchema.extend({
  role: userRoleSchema.optional(),
  employment_status: employmentStatusSchema.optional(),
});
export type AdminProfileUpdate = z.infer<typeof adminProfileUpdateSchema>;

/** Payload the mobile app sends when registering this phone. */
export const deviceRegistrationSchema = z.object({
  device_id: z.string().trim().min(1).max(200),
  platform: devicePlatformSchema,
  push_token: z.string().max(500).nullable().optional(),
});
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;
