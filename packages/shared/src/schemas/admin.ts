import { z } from 'zod';

import { employmentStatusSchema, fullNameSchema, phoneSchema, userRoleSchema } from './user';

// Inputs for the admin console. Server actions parse FormData with these, so
// empty form fields arrive as '' and are normalised here.

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type SignInInput = z.infer<typeof signInSchema>;

/** 6-digit code from an authenticator app. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'Enter the 6-digit code from your authenticator app');

export const setPasswordSchema = z
  .object({
    // Same rule as Supabase Auth (minimum_password_length 10, letters_digits).
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(200)
      .regex(/[A-Za-z]/, 'Include at least one letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const inviteUserSchema = z.object({
  full_name: fullNameSchema,
  email: emailSchema,
  phone: z.preprocess(emptyToUndefined, phoneSchema.optional()),
  role: userRoleSchema,
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

const userIdSchema = z.uuid('Invalid user');

export const changeRoleSchema = z.object({
  user_id: userIdSchema,
  role: userRoleSchema,
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const setEmploymentStatusSchema = z.object({
  user_id: userIdSchema,
  employment_status: employmentStatusSchema,
});
export type SetEmploymentStatusInput = z.infer<typeof setEmploymentStatusSchema>;

export const resetDeviceSchema = z.object({
  user_id: userIdSchema,
});
export type ResetDeviceInput = z.infer<typeof resetDeviceSchema>;

/** Query params on an invite / password-reset link (email → web → app). */
export const authLinkParamsSchema = z.object({
  token_hash: z.string().min(1).max(500),
  type: z.enum(['invite', 'recovery']),
});
export type AuthLinkParams = z.infer<typeof authLinkParamsSchema>;
