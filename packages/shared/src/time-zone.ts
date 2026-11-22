// Wall-clock times in a named time zone (settings.time_zone), without a
// date library. Shifts are stored as instants (timestamptz); people type and
// read them as "date + time" in the company's zone, whatever zone the server
// or browser happens to be in.

import { addDaysIso } from './dates';

export const DEFAULT_TIME_ZONE = 'Africa/Lagos';

/** True when the runtime knows this IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export type ZonedParts = {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM", 24-hour */
  time: string;
};

function zonedFields(instant: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** The wall-clock date and time of an instant in `timeZone`. */
export function toZoned(instant: Date | string, timeZone: string): ZonedParts {
  const f = zonedFields(new Date(instant), timeZone);
  return { date: `${f.year}-${f.month}-${f.day}`, time: `${f.hour}:${f.minute}` };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Lagos: +1h). */
function offsetMs(instant: number, timeZone: string): number {
  const f = zonedFields(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    Number(f.year),
    Number(f.month) - 1,
    Number(f.day),
    Number(f.hour),
    Number(f.minute),
    Number(f.second),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at wall-clock `date` + `time` ("HH:MM") in `timeZone`. Handles
 * DST: a time skipped by a spring-forward resolves to just after the gap.
 */
export function fromZoned(date: string, time: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const first = naive - offsetMs(naive, timeZone);
  const second = naive - offsetMs(first, timeZone);
  return new Date(second);
}

/** Today's date in `timeZone`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return toZoned(now, timeZone).date;
}

/** Monday of the week containing `dateIso` ("YYYY-MM-DD"). */
export function startOfWeekIso(dateIso: string): string {
  const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysIso(dateIso, -((day + 6) % 7));
}

/** "07:00–19:00" in `timeZone`. */
export function formatTimeRange(startsAt: string, endsAt: string, timeZone: string): string {
  return `${toZoned(startsAt, timeZone).time}–${toZoned(endsAt, timeZone).time}`;
}

/** "Mon 5 Jan" for a "YYYY-MM-DD". */
export function formatDayShort(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
