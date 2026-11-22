import { type AttendanceType, toZoned } from '@deltaguard/shared';

import type { AttendanceEvent } from './clock-queue';
import type { MyShift } from './shifts';

// Plain-English feedback for an officer after clocking in or out.

export type ClockMessage = {
  tone: 'success' | 'warn' | 'error';
  title: string;
  lines: string[];
};

const VERB: Record<AttendanceType, string> = { clock_in: 'clock-in', clock_out: 'clock-out' };
const DONE: Record<AttendanceType, string> = { clock_in: 'Clocked in', clock_out: 'Clocked out' };

/** Flags a supervisor reviews (the others are informational for the officer). */
const SUPERVISOR_FLAGS = new Set([
  'late',
  'early_leave',
  'out_of_range',
  'mock_location',
  'post_orders_unread',
]);

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

const time = (iso: string, timeZone: string) => toZoned(iso, timeZone).time;

/**
 * What a recorded clock event means. `shift` is optional: a queued event can
 * be delivered after the shift has dropped out of the list.
 */
export function describeEvent(
  event: AttendanceEvent,
  shift: MyShift | null,
  timeZone: string,
): ClockMessage {
  const type = event.type;
  const flags = new Set(event.flags);
  const delayed = flags.has('delayed');
  // For a delayed event, the moment that counts is when it happened on the phone.
  const at = delayed && event.device_time ? event.device_time : event.recorded_at;

  if (!event.accepted) {
    return {
      tone: 'error',
      title: `Your ${VERB[type]} was not accepted`,
      lines: [
        'This phone isn’t your registered device, so the attempt was refused and recorded.',
        'Ask an admin to reset your device, then sign in again on your own phone.',
      ],
    };
  }

  const lines: string[] = [];
  const radius = shift?.site?.radiusM;
  const youAre = delayed ? 'You were' : 'You are';

  if (flags.has('out_of_range')) {
    const distance = event.distance_from_site_m;
    lines.push(
      distance !== null
        ? `${youAre} ${formatDistance(Number(distance))} from the site${
            radius ? ` (allowed: ${formatDistance(radius)})` : ''
          }.`
        : `${youAre} outside the site’s allowed area.`,
    );
  }
  if (flags.has('late')) {
    lines.push(
      shift
        ? `You clocked in late: the shift started at ${time(shift.startsAt, timeZone)}.`
        : 'You clocked in late.',
    );
  }
  if (flags.has('early_leave')) {
    lines.push(
      shift
        ? `You clocked out before the shift’s end at ${time(shift.endsAt, timeZone)}.`
        : 'You clocked out before the end of the shift.',
    );
  }
  if (flags.has('mock_location')) {
    lines.push('A fake-GPS (mock location) app was detected on this phone.');
  }
  if (flags.has('post_orders_unread')) {
    lines.push(
      'The site’s post orders had changed and you hadn’t acknowledged them. Read and acknowledge them now on the shift screen.',
    );
  }
  if (flags.has('low_accuracy')) {
    lines.push(
      event.accuracy_m !== null
        ? `Your GPS signal was weak (accurate to about ${formatDistance(Number(event.accuracy_m))}).`
        : 'Your phone couldn’t say how accurate its GPS position was.',
    );
  }
  if ([...flags].some((f) => SUPERVISOR_FLAGS.has(f))) {
    lines.push('Your supervisor has been notified.');
  }
  if (delayed) {
    lines.push(
      `Your phone was offline, so this was sent later. It is recorded with your phone’s time (${time(at, timeZone)}) and marked as delayed.`,
    );
  }

  const warn = [...flags].some((f) => f !== 'delayed');
  return {
    tone: warn ? 'warn' : 'success',
    title: `${DONE[type]} at ${time(at, timeZone)}`,
    lines,
  };
}

export function describeQueued(type: AttendanceType, deviceTime: string, timeZone: string) {
  return {
    tone: 'warn',
    title: `No internet: ${VERB[type]} saved on this phone`,
    lines: [
      `Your ${VERB[type]} at ${time(deviceTime, timeZone)} and your location are saved on this phone.`,
      'It will be sent automatically when you’re back online, marked as delayed. Keep the app installed and stay signed in.',
    ],
  } satisfies ClockMessage;
}

/** A queued event the server refused when it was finally sent. */
export function describeRefusedQueued(
  type: AttendanceType,
  deviceTime: string | undefined,
  message: string,
  timeZone: string,
): ClockMessage {
  return {
    tone: 'error',
    title: `Your ${VERB[type]}${deviceTime ? ` from ${time(deviceTime, timeZone)}` : ''} couldn’t be recorded`,
    lines: [message, 'Tell your supervisor so they can correct your timesheet.'],
  };
}
