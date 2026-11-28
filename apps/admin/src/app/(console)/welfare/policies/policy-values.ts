// Plain module (server and client): the policy form's values and defaults.

export type PolicyValues = {
  id?: string;
  name: string;
  min_interval_minutes: number;
  max_interval_minutes: number;
  night_start: string | null;
  night_end: string | null;
  night_min_interval_minutes: number | null;
  night_max_interval_minutes: number | null;
  response_seconds: number;
  alarm_seconds: number;
  call_attempts: number;
  call_gap_seconds: number;
  supervisor_alert_after_seconds: number | null;
  enabled: boolean;
};

export const NEW_POLICY: PolicyValues = {
  name: '',
  min_interval_minutes: 45,
  max_interval_minutes: 75,
  night_start: '22:00',
  night_end: '06:00',
  night_min_interval_minutes: 30,
  night_max_interval_minutes: 50,
  response_seconds: 60,
  alarm_seconds: 60,
  call_attempts: 2,
  call_gap_seconds: 150,
  supervisor_alert_after_seconds: null,
  enabled: true,
};
