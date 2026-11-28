import 'server-only';

import { friendlyError } from '@deltaguard/shared';

// What server code shows people when something fails, and what it logs.
//
// Shown: our own database messages (raised by our functions with a sentence
// written for people: P0001, 22023, DGxxx), a plain sentence for common
// constraint errors, otherwise "Something went wrong". Never raw SQL, table or
// constraint names, row values or stack traces.
// Logged: the error code and the action only. Database error `details` (which
// can contain row values: names, emails, phone numbers) are never logged.

type ErrorLike = { code?: unknown; message?: unknown; name?: unknown };

const CONSTRAINT_MESSAGES: Record<string, string> = {
  '23505': 'That already exists.',
  '23503': 'It is still used elsewhere, so it can’t be changed or removed.',
  '23514': 'Some of the values aren’t allowed.',
  '23502': 'A required value is missing.',
  '23P01': 'It overlaps with something that already exists.',
  '22001': 'A value is too long.',
};

/** Logs a failure without personal data: action + error code only. */
export function logFailure(action: string, error: unknown): void {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const code =
    typeof e.code === 'string' ? e.code : typeof e.name === 'string' ? e.name : 'unknown';
  console.error(`[${action}] failed (${code})`);
}

/** A sentence safe to show for a failed request. */
export function publicMessage(error: unknown, action?: string): string {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';
  if (CONSTRAINT_MESSAGES[code]) {
    return `${action ? `Couldn’t ${action}. ` : ''}${CONSTRAINT_MESSAGES[code]}`;
  }
  return friendlyError(error, { action });
}

/** The result (ActionState) for a failed server action (logged, message made safe). */
export function failed(error: unknown, action = 'save'): { ok: false; message: string } {
  logFailure(action, error);
  return { ok: false, message: publicMessage(error, action) };
}

/** An Error whose message is safe to show ("Couldn't load X."), for loaders. */
export class LoadError extends Error {
  constructor(what: string) {
    super(`Couldn’t load ${what}. Try again.`);
    this.name = 'LoadError';
  }
}

/** Logs and returns a LoadError, e.g. `throw loadError('the dashboard', error)`. */
export function loadError(what: string, error: unknown): LoadError {
  logFailure(`load ${what}`, error);
  return new LoadError(what);
}

/** Text for an ErrorText when loading failed. */
export function loadFailed(what: string, error: unknown): string {
  return loadError(what, error).message;
}

/** Text to show for an exception caught around loaders: only LoadError text passes through. */
export function caughtMessage(error: unknown, what = 'this page'): string {
  if (error instanceof LoadError) return error.message;
  logFailure(`load ${what}`, error);
  return `Couldn’t load ${what}. Try again.`;
}
