import {
  describeExpiry,
  type EmploymentStatus,
  expiryStatus,
  FORM_INBOX_STATUS_LABELS,
  FORM_TEMPLATE_STATUS_LABELS,
  type FormInboxStatus,
  type FormTemplateStatus,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  type IncidentSeverity,
  type IncidentStatus,
  type ShiftStatus,
} from '@deltaguard/shared';

import { Badge, type BadgeTone } from './ui';

const STATUS_TONE: Record<EmploymentStatus, BadgeTone> = {
  active: 'good',
  suspended: 'warn',
  terminated: 'bad',
};

export function EmploymentBadge({ status }: { status: EmploymentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span className="capitalize">{status}</span>
    </Badge>
  );
}

/** Licence expiry: red when expired, amber within 30 days, else neutral. */
export function ExpiryBadge({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  const status = expiryStatus(expiresOn, today);
  const tone: BadgeTone =
    status.kind === 'expired' ? 'bad' : status.kind === 'expiring' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{describeExpiry(status)}</Badge>;
}

const SHIFT_STATUS: Record<ShiftStatus, { label: string; tone: BadgeTone }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  acknowledged: { label: 'Acknowledged', tone: 'neutral' },
  in_progress: { label: 'On shift', tone: 'good' },
  completed: { label: 'Completed', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function shiftStatusLabel(status: ShiftStatus): string {
  return SHIFT_STATUS[status].label;
}

export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  return <Badge tone={SHIFT_STATUS[status].tone}>{SHIFT_STATUS[status].label}</Badge>;
}

const INCIDENT_STATUS_TONE: Record<IncidentStatus, BadgeTone> = {
  submitted: 'warn',
  under_review: 'warn',
  approved: 'good',
  returned: 'neutral',
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <Badge tone={INCIDENT_STATUS_TONE[status]}>{INCIDENT_STATUS_LABELS[status]}</Badge>;
}

const SEVERITY_TONE: Record<IncidentSeverity, BadgeTone> = {
  low: 'neutral',
  medium: 'warn',
  high: 'bad',
  critical: 'bad',
};

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]}>
      {severity === 'critical' ? '⚠ ' : ''}
      {INCIDENT_SEVERITY_LABELS[severity]}
    </Badge>
  );
}

const FORM_TEMPLATE_TONE: Record<FormTemplateStatus, BadgeTone> = {
  draft: 'warn',
  published: 'good',
  archived: 'neutral',
};

export function FormTemplateStatusBadge({ status }: { status: FormTemplateStatus }) {
  return <Badge tone={FORM_TEMPLATE_TONE[status]}>{FORM_TEMPLATE_STATUS_LABELS[status]}</Badge>;
}

const FORM_INBOX_TONE: Record<FormInboxStatus, BadgeTone> = {
  not_started: 'neutral',
  draft: 'neutral',
  submitted: 'warn',
  returned: 'neutral',
  approved: 'good',
};

export function FormSubmissionStatusBadge({ status }: { status: FormInboxStatus }) {
  return <Badge tone={FORM_INBOX_TONE[status]}>{FORM_INBOX_STATUS_LABELS[status]}</Badge>;
}
