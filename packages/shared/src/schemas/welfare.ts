import { z } from 'zod';

import { firstParam, isoDateSchema } from './common';

// Welfare checks (lone-worker safety). Mirrors public.welfare_check_policies
// and the welfare RPCs' arguments; the database re-checks everything.

export const WELFARE_CHECK_STATUSES = [
  'scheduled',
  'prompted',
  'responded',
  'alarm',
  'calling',
  'escalated',
  'resolved',
  'cancelled',
] as const;
export type WelfareCheckStatus = (typeof WELFARE_CHECK_STATUSES)[number];

export const WELFARE_CHECK_STATUS_LABELS: Record<WelfareCheckStatus, string> = {
  scheduled: 'Scheduled',
  prompted: 'Waiting for answer',
  responded: 'Answered',
  alarm: 'Alarm',
  calling: 'Calling officer',
  escalated: 'Escalated',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

/** Flags on an answer (welfare_checks.response_flags). */
export const WELFARE_RESPONSE_FLAG_LABELS = {
  late: 'Late',
  offline: 'Sent offline',
  after_escalation: 'After escalation',
  unregistered_device: 'Unregistered phone',
} as const;

/** Notification types the welfare functions send (push routing). */
export const WELFARE_NOTIFICATION_TYPES = [
  'welfare_check',
  'welfare_alarm',
  'welfare_escalated',
  'welfare_update',
  'welfare_paused',
  'welfare_resumed',
] as const;

/** Suggested resolution notes for the console. */
export const WELFARE_RESOLUTION_EXAMPLES = [
  'Officer was asleep',
  'Phone battery died',
  'Officer unwell, relief sent',
  'No signal at post, officer safe',
] as const;

const minutes = z.coerce.number().int().min(5, 'At least 5 minutes').max(720, 'At most 12 hours');
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a 24-hour time, e.g. 22:00');

/** Admins: a welfare check policy. */
export const welfarePolicySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    min_interval_minutes: minutes,
    max_interval_minutes: minutes,
    night_start: time.nullable(),
    night_end: time.nullable(),
    night_min_interval_minutes: minutes.nullable(),
    night_max_interval_minutes: minutes.nullable(),
    response_seconds: z.coerce.number().int().min(15).max(900).default(60),
    alarm_seconds: z.coerce.number().int().min(0).max(900).default(60),
    call_attempts: z.coerce.number().int().min(0).max(5).default(2),
    call_gap_seconds: z.coerce.number().int().min(30).max(900).default(150),
    supervisor_alert_after_seconds: z.coerce.number().int().min(60).max(7200).nullable(),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.max_interval_minutes < v.min_interval_minutes) {
      ctx.addIssue({
        code: 'custom',
        path: ['max_interval_minutes'],
        message: 'Must be at least the minimum interval',
      });
    }
    if ((v.night_start === null) !== (v.night_end === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['night_end'],
        message: 'Set both night start and end',
      });
    }
    if (v.night_start !== null) {
      if (v.night_start.slice(0, 5) === v.night_end?.slice(0, 5)) {
        ctx.addIssue({
          code: 'custom',
          path: ['night_end'],
          message: 'Night end must differ from start',
        });
      }
      if (v.night_min_interval_minutes === null || v.night_max_interval_minutes === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['night_min_interval_minutes'],
          message: 'Set the night interval',
        });
      } else if (v.night_max_interval_minutes < v.night_min_interval_minutes) {
        ctx.addIssue({
          code: 'custom',
          path: ['night_max_interval_minutes'],
          message: 'Must be at least the minimum night interval',
        });
      }
    }
  });
export type WelfarePolicyInput = z.infer<typeof welfarePolicySchema>;

/** Officer: answer a check (respond_welfare_check). */
export const respondWelfareCheckSchema = z.object({
  p_check_id: z.uuid(),
  p_responded_at_device: z.iso.datetime({ offset: true }),
  p_biometric_verified: z.boolean(),
  p_offline: z.boolean(),
  p_device_id: z.string().min(1).max(200),
});
export type RespondWelfareCheckInput = z.infer<typeof respondWelfareCheckSchema>;

/** Staff: resolve a check (notes required). */
export const resolveWelfareCheckSchema = z.object({
  p_check_id: z.uuid(),
  p_notes: z
    .string()
    .trim()
    .min(1, 'Add a note: what happened and what was done')
    .max(2000, 'At most 2,000 characters'),
});

/** Officer's phone: heartbeat while on duty (no location). */
export const deviceHeartbeatSchema = z.object({
  p_device_id: z.string().min(1).max(200),
  p_battery_level: z.number().int().min(0).max(100).nullable(),
  p_app_state: z.enum(['active', 'background', 'inactive', 'unknown']),
});

/** Staff: take an escalated check (notes optional). */
export const acknowledgeWelfareCheckSchema = z.object({
  p_check_id: z.uuid(),
  p_notes: z.string().trim().max(2000, 'At most 2,000 characters').optional(),
});

/** Admins: pause checks for a shift in progress (resume time optional). */
export const pauseWelfareChecksSchema = z.object({
  p_shift_id: z.uuid(),
  p_reason: z
    .string()
    .trim()
    .min(1, 'Give a reason for the pause')
    .max(500, 'At most 500 characters'),
  p_resume_at: z.iso.datetime({ offset: true }).nullable(),
});

/** Suggested pause reasons for the console. */
export const WELFARE_PAUSE_EXAMPLES = [
  'Approved break',
  'Meal break',
  'Supervisor on site with the officer',
  'Phone being replaced',
] as const;

/** Admins: a site's policy (null = company default) and whether checks run there. */
export const siteWelfareSettingsSchema = z.object({
  site_id: z.uuid(),
  welfare_policy_id: z.uuid().nullable(),
  welfare_checks_enabled: z.boolean(),
});

/** Admins: the company default policy (null = no checks unless a site has its own). */
export const companyWelfarePolicySchema = z.object({
  welfare_policy_id: z.uuid().nullable(),
});

export const WELFARE_REPORT_GROUPS = ['officer', 'site'] as const;
export const WELFARE_REPORT_PERIODS = ['all', 'night', 'day'] as const;
export const WELFARE_REPORT_PERIOD_LABELS: Record<(typeof WELFARE_REPORT_PERIODS)[number], string> =
  {
    all: 'All hours',
    night: 'Night hours only',
    day: 'Day hours only',
  };

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Report filters from the URL (page and CSV export). Bad values fall back to
 * defaults; `from` / `to` default in the page (they depend on "today").
 */
export const welfareReportFiltersSchema = z.object({
  from: z.preprocess(firstParam, isoDateSchema.optional()).catch(undefined),
  to: z.preprocess(firstParam, isoDateSchema.optional()).catch(undefined),
  group: z.preprocess(firstParam, z.enum(WELFARE_REPORT_GROUPS)).catch('officer'),
  period: z.preprocess(firstParam, z.enum(WELFARE_REPORT_PERIODS)).catch('all'),
  // Blank = the company default policy's night hours (else 22:00-06:00).
  night_start: z.preprocess(firstParam, hhmm.optional()).catch(undefined),
  night_end: z.preprocess(firstParam, hhmm.optional()).catch(undefined),
  officer: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  site: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
});
export type WelfareReportFilters = z.infer<typeof welfareReportFiltersSchema>;

/**
 * Admins: welfare checks for chosen officers. 'inherit' = follow their site /
 * the company default, 'off' = no checks for them, or a policy id.
 */
export const officerWelfareSettingSchema = z.object({
  officer_ids: z.array(z.uuid()).min(1, 'Choose at least one officer').max(500),
  setting: z.union([z.literal('inherit'), z.literal('off'), z.uuid()], 'Choose a setting'),
});
export type OfficerWelfareSettingInput = z.infer<typeof officerWelfareSettingSchema>;

/** Where an officer's welfare policy comes from (welfare_board.policy_source). */
export const WELFARE_POLICY_SOURCE_LABELS: Record<string, string> = {
  officer: 'Officer’s own policy',
  officer_off: 'Checks off for this officer',
  site: 'Site policy',
  site_off: 'Checks off at this site',
  company: 'Company default',
  none: 'No policy',
};
