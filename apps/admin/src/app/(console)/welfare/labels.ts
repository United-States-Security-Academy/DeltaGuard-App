import {
  WELFARE_CHECK_STATUS_LABELS,
  WELFARE_RESPONSE_FLAG_LABELS,
  type WelfareCheckStatus,
} from '@deltaguard/shared';

import type { BadgeTone } from '@/components/ui';

// Plain module (server and client): wording and thresholds for welfare pages.

export const WELFARE_STATUS_TONE: Record<WelfareCheckStatus, BadgeTone> = {
  scheduled: 'neutral',
  prompted: 'warn',
  responded: 'good',
  alarm: 'bad',
  calling: 'bad',
  escalated: 'bad',
  resolved: 'neutral',
  cancelled: 'neutral',
};

export function welfareStatusLabel(status: WelfareCheckStatus): string {
  return WELFARE_CHECK_STATUS_LABELS[status];
}

export function responseFlagLabel(flag: string): string {
  return WELFARE_RESPONSE_FLAG_LABELS[flag as keyof typeof WELFARE_RESPONSE_FLAG_LABELS] ?? flag;
}

/** A heartbeat older than this means the phone may be off or out of signal. */
export const HEARTBEAT_STALE_MINUTES = 10;
/** Battery at or below this is shown in red. */
export const BATTERY_LOW_PERCENT = 20;

/** "45 s", "2 min 5 s", "1 h 3 min". */
export function formatSeconds(total: number | null | undefined): string {
  if (total === null || total === undefined || Number.isNaN(total)) return '—';
  const s = Math.round(total);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Labels for steps in welfare_checks.escalation_log. */
export const WELFARE_STEP_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  prompted: 'Officer prompted on the phone',
  alarm: 'Alarm sounded on the phone',
  call_queued: 'Automated call queued',
  call_placed: 'Automated call placed',
  call_failed: 'Automated call failed',
  call_skipped: 'Automated call skipped',
  escalated: 'Escalated to supervisors and admins',
  sms_sent: 'SMS sent',
  sms_failed: 'SMS failed',
  sms_skipped: 'SMS skipped',
  responded: 'Officer answered',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
  shift_ended: 'Shift ended',
};

const REASON_LABELS: Record<string, string> = {
  time_limit: 'policy time limit reached',
  no_answer: 'no answer',
  no_answer_after_calls: 'no answer after the calls',
  paused: 'checks paused',
};

/** Plain-language details for a log entry. */
export function describeWelfareStep(entry: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const str = (k: string) =>
    typeof entry[k] === 'string' && entry[k] ? (entry[k] as string) : null;
  const reason = str('reason');
  if (reason) parts.push(REASON_LABELS[reason] ?? reason);
  if (str('by')) parts.push(`by ${str('by')}`);
  if (str('notes')) parts.push(`“${str('notes')}”`);
  if (typeof entry.call === 'number') parts.push(`call ${entry.call}`);
  if (str('to')) parts.push(`to ${str('to')}`);
  if (Array.isArray(entry.push_user_ids)) parts.push(`${entry.push_user_ids.length} pushed`);
  if (typeof entry.sms_queued === 'number') parts.push(`${entry.sms_queued} SMS queued`);
  if (typeof entry.without_sms_number === 'number' && entry.without_sms_number > 0) {
    parts.push(`${entry.without_sms_number} without a mobile number`);
  }
  if (typeof entry.battery_level === 'number') parts.push(`battery ${entry.battery_level}%`);
  if (typeof entry.response_seconds === 'number') {
    parts.push(`after ${formatSeconds(entry.response_seconds)}`);
  }
  if (Array.isArray(entry.flags) && entry.flags.length) {
    parts.push(entry.flags.map((f) => responseFlagLabel(String(f))).join(', '));
  }
  if (str('error')) parts.push(str('error')!);
  return parts.length ? parts.join(' · ') : null;
}
