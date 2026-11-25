export const APP_NAME = 'DeltaGuard';
export const COMPANY_NAME = 'Deltacon Security';

// Keep in sync with the Postgres enums in supabase/migrations.
export const USER_ROLES = ['officer', 'supervisor', 'admin'] as const;
export const EMPLOYMENT_STATUSES = ['active', 'suspended', 'terminated'] as const;
export const DEVICE_PLATFORMS = ['ios', 'android'] as const;

// Private storage bucket for license scans. Object path: <user_id>/<file>.
export const LICENSES_BUCKET = 'licenses';
export const LICENSE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const LICENSE_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
] as const;

export const DEFAULT_CLOCK_IN_RADIUS_M = 150;

/** File extension used when storing a scan of each allowed type. */
export const LICENSE_FILE_EXTENSIONS: Record<(typeof LICENSE_FILE_MIME_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

// Phase 3: shifts and attendance. Keep in sync with the Postgres enums and the
// attendance_events.flags check constraint.
export const SHIFT_STATUSES = [
  'scheduled',
  'acknowledged',
  'in_progress',
  'completed',
  'missed',
  'cancelled',
] as const;
export const ATTENDANCE_TYPES = ['clock_in', 'clock_out'] as const;
export const ATTENDANCE_FLAGS = [
  'late',
  'early_leave',
  'out_of_range',
  'mock_location',
  'low_accuracy',
  'wrong_device',
  'delayed',
  'post_orders_unread',
] as const;
export type AttendanceFlag = (typeof ATTENDANCE_FLAGS)[number];

/** Label for a flag string from the database (unknown values are shown as-is). */
export function attendanceFlagLabel(flag: string): string {
  return (ATTENDANCE_FLAG_LABELS as Record<string, string>)[flag] ?? flag;
}

/** Plain-English labels for attendance flags (supervisor views, officer feedback). */
export const ATTENDANCE_FLAG_LABELS: Record<(typeof ATTENDANCE_FLAGS)[number], string> = {
  late: 'Late',
  early_leave: 'Left early',
  out_of_range: 'Outside the site radius',
  mock_location: 'Fake GPS detected',
  low_accuracy: 'Poor GPS accuracy',
  wrong_device: 'Unregistered phone',
  delayed: 'Sent late (offline)',
  post_orders_unread: 'Post orders not acknowledged',
};

// Phase 6: post orders and daily activity reports.

/**
 * SQLSTATE clock_event() raises when a live clock-in is refused because the
 * officer hasn't acknowledged the site's latest post orders.
 */
export const POST_ORDERS_REQUIRED_CODE = 'DG001';

/** Keep in sync with the Postgres enum dar_entry_type. */
export const DAR_ENTRY_TYPES = ['patrol', 'observation', 'visitor', 'handover', 'other'] as const;
export type DarEntryType = (typeof DAR_ENTRY_TYPES)[number];

export const DAR_ENTRY_LABELS: Record<DarEntryType, string> = {
  patrol: 'Patrol',
  observation: 'Observation',
  visitor: 'Visitor',
  handover: 'Handover',
  other: 'Other',
};

/** Private bucket for DAR photos. Object path: <officer_id>/<report_id>/<file>. */
export const DAR_PHOTOS_BUCKET = 'dar-photos';
export const DAR_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export const HANDOVER_NOTE_MAX = 2000;

// Phase 7: incident reports. Keep in sync with the incidents.category check
// constraint and the incident_severity / incident_status enums.
export const INCIDENT_CATEGORIES = [
  'theft',
  'trespass',
  'vandalism',
  'assault',
  'fire',
  'medical',
  'suspicious_activity',
  'safety_hazard',
  'property_damage',
  'alarm',
  'other',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  theft: 'Theft',
  trespass: 'Trespass',
  vandalism: 'Vandalism',
  assault: 'Assault',
  fire: 'Fire',
  medical: 'Medical',
  suspicious_activity: 'Suspicious activity',
  safety_hazard: 'Safety hazard',
  property_damage: 'Property damage',
  alarm: 'Alarm',
  other: 'Other',
};

/** Label for a category string from the database (unknown values are shown as-is). */
export function incidentCategoryLabel(category: string): string {
  return (INCIDENT_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const INCIDENT_STATUSES = ['submitted', 'under_review', 'approved', 'returned'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  returned: 'Returned for changes',
};

/** Private bucket for incident photos. Object path: <officer_id>/<incident_id>/<photo id>.jpg */
export const INCIDENT_PHOTOS_BUCKET = 'incident-photos';
export const INCIDENT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const INCIDENT_MAX_PHOTOS = 10;

// Messaging ----------------------------------------------------------------------

/** Private bucket for chat images. Object path: <conversation_id>/<sender_id>/<random>.<ext> */
export const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments';
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const CHAT_MESSAGE_MAX_LENGTH = 4000;
/** Messages loaded per page (newest first). */
export const CHAT_PAGE_SIZE = 30;
/** Notification type used for chat pushes (kept out of the alert inbox). */
export const MESSAGE_NOTIFICATION_TYPE = 'message';

export const CONVERSATION_TYPES = ['direct', 'group'] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/** "<conversation_id>/<sender_id>/<random>.<ext>" */
export function chatAttachmentPath(
  conversationId: string,
  senderId: string,
  fileId: string,
  ext: string,
): string {
  return `${conversationId}/${senderId}/${fileId}.${ext}`;
}

// SOS ----------------------------------------------------------------------------

/** Press and hold the SOS button this long to start the countdown. */
export const SOS_HOLD_MS = 2000;
/** Seconds to cancel before the alert is sent. */
export const SOS_COUNTDOWN_SECONDS = 5;
/** While an alert is open (app in the foreground), send the position this often. */
export const SOS_LOCATION_INTERVAL_MS = 30_000;
/** Minutes without acknowledgement before the next escalation contact is alerted. */
export const SOS_ESCALATION_MINUTES = 2;
/** Emergency services (Deltacon operates in Texas, USA). */
export const EMERGENCY_NUMBER = '911';

export const SOS_STATUSES = ['active', 'acknowledged', 'resolved', 'false_alarm'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];
export const SOS_STATUS_LABELS: Record<SosStatus, string> = {
  active: 'Active',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  false_alarm: 'False alarm',
};

export const SOS_EVENT_LABELS: Record<string, string> = {
  triggered: 'SOS raised',
  notified: 'Staff alerted (push + SMS)',
  escalated: 'Escalated to the next contact',
  reminder: 'Staff reminded',
  escalation_exhausted: 'Escalation list used up; staff reminded',
  sms_sent: 'SMS sent',
  sms_failed: 'SMS failed',
  sms_skipped: 'SMS not sent',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  false_alarm: 'Closed as a false alarm',
  marked_safe: 'Officer marked themselves safe',
  officer_called_emergency: 'Officer called emergency services',
  officer_called_supervisor: 'Officer called a supervisor',
  officer_sms_fallback: 'Officer opened the SMS fallback (no connection)',
};

/** Google Maps link for a position (works on phones and desktops). */
export function mapLink(latitude: number | string, longitude: number | string): string {
  return `https://maps.google.com/?q=${latitude},${longitude}`;
}
