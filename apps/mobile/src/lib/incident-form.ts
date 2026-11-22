import {
  fromZoned,
  type IncidentCategory,
  incidentFormSchema,
  type IncidentSeverity,
  todayInZone,
  toZoned,
} from '@deltaguard/shared';

import type { IncidentFormState, LocalIncident, SubmitPayload } from './incident-store';
import type { MyShift } from './shifts';

/** A blank report, with the time set to now and the site of the current shift. */
export function newIncident(
  id: string,
  timeZone: string,
  defaults: { siteId: string | null; shiftId: string | null },
): LocalIncident {
  const now = toZoned(new Date(), timeZone);
  return {
    id,
    mode: 'new',
    form: {
      siteId: defaults.siteId,
      shiftId: defaults.shiftId,
      date: todayInZone(timeZone),
      time: now.time,
      category: null,
      severity: null,
      description: '',
      peopleInvolved: '',
      policeCalled: false,
    },
    photos: [],
    existingPhotoCount: 0,
    originalSiteId: null,
    reviewNotes: null,
    state: 'draft',
    payload: null,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    updatedAt: Date.now(),
    queuedAt: null,
  };
}

/** A returned report, opened for editing on the phone. */
export function fromReturned(
  incident: {
    id: string;
    site_id: string;
    shift_id: string | null;
    occurred_at: string;
    category: string;
    severity: IncidentSeverity;
    description: string;
    people_involved: string | null;
    police_called: boolean;
    review_notes: string | null;
    incident_photos: unknown[];
  },
  timeZone: string,
): LocalIncident {
  const at = toZoned(incident.occurred_at, timeZone);
  return {
    ...newIncident(incident.id, timeZone, { siteId: incident.site_id, shiftId: incident.shift_id }),
    mode: 'resubmit',
    form: {
      siteId: incident.site_id,
      shiftId: incident.shift_id,
      date: at.date,
      time: at.time,
      category: incident.category as IncidentCategory,
      severity: incident.severity,
      description: incident.description,
      peopleInvolved: incident.people_involved ?? '',
      policeCalled: incident.police_called,
    },
    existingPhotoCount: incident.incident_photos.length,
    originalSiteId: incident.site_id,
    reviewNotes: incident.review_notes,
  };
}

/** The officer's shift at this site around this time, to link the report to. */
export function matchingShift(
  shifts: readonly MyShift[],
  siteId: string | null,
  occurredAt: number,
): MyShift | null {
  if (!siteId || Number.isNaN(occurredAt)) return null;
  const HOUR = 60 * 60_000;
  return (
    shifts.find(
      (s) =>
        s.site?.id === siteId &&
        s.status !== 'cancelled' &&
        occurredAt >= Date.parse(s.startsAt) - HOUR &&
        occurredAt <= Date.parse(s.endsAt) + HOUR,
    ) ?? null
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The instant typed in the form, or NaN. */
export function occurredAtMs(form: IncidentFormState, timeZone: string): number {
  if (!DATE.test(form.date) || !TIME.test(form.time)) return Number.NaN;
  return fromZoned(form.date, form.time, timeZone).getTime();
}

/**
 * The shift to link: the officer's shift at that site and time, else (when
 * resubmitting without changing the site) the one it was already linked to.
 */
export function shiftToLink(
  item: LocalIncident,
  shifts: readonly MyShift[],
  timeZone: string,
): string | null {
  const match = matchingShift(shifts, item.form.siteId, occurredAtMs(item.form, timeZone));
  if (match) return match.id;
  return item.mode === 'resubmit' && item.form.siteId === item.originalSiteId
    ? item.form.shiftId
    : null;
}

export type FormErrors = Partial<Record<keyof IncidentFormState | 'photos', string>>;

/** Validates the form; on success, the payload to queue. */
export function toPayload(
  item: LocalIncident,
  timeZone: string,
): { ok: true; payload: SubmitPayload } | { ok: false; errors: FormErrors } {
  const f = item.form;
  const at = occurredAtMs(f, timeZone);
  const parsed = incidentFormSchema.safeParse({
    site_id: f.siteId ?? '',
    shift_id: f.shiftId,
    occurred_at: Number.isNaN(at) ? '' : new Date(at).toISOString(),
    category: f.category ?? undefined,
    severity: f.severity ?? undefined,
    description: f.description,
    people_involved: f.peopleInvolved,
    police_called: f.policeCalled,
  });
  if (!parsed.success) {
    const errors: FormErrors = {};
    for (const issue of parsed.error.issues) {
      const key = {
        site_id: 'siteId',
        shift_id: 'siteId',
        occurred_at: 'time',
        category: 'category',
        severity: 'severity',
        description: 'description',
        people_involved: 'peopleInvolved',
        police_called: 'policeCalled',
      }[String(issue.path[0])] as keyof FormErrors | undefined;
      if (key) errors[key] ??= issue.message;
    }
    if (Number.isNaN(at)) errors.time = 'Use the format YYYY-MM-DD and HH:MM';
    return { ok: false, errors };
  }
  const d = parsed.data;
  return {
    ok: true,
    payload: {
      p_id: item.id,
      p_site_id: d.site_id,
      p_shift_id: d.shift_id,
      p_occurred_at: d.occurred_at,
      p_category: d.category,
      p_severity: d.severity,
      p_description: d.description,
      p_people_involved: d.people_involved === '' ? null : d.people_involved,
      p_police_called: d.police_called,
    },
  };
}
