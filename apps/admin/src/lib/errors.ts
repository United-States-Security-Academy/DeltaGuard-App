import { friendlyError, isSessionError } from '@deltaguard/shared';
import { invalidateAccessToken } from './supabase/client';

// Error wording for the console's browser code. Raw database text is logged to
// the browser console, never shown.

const SESSION_HINT = 'Refresh the page. If it keeps happening, sign out and sign back in.';

/** A sentence to show for a failed request, e.g. consoleError(e, 'load conversations'). */
export function consoleError(error: unknown, action?: string): string {
  console.warn(action ? `Couldn't ${action}:` : 'Request failed:', error);
  return friendlyError(error, { action, sessionHint: SESSION_HINT });
}

/**
 * Runs a Supabase request; if it failed because the access token had expired
 * (often after the internet dropped), fetches a fresh token from the server
 * and runs it once more.
 */
export async function withSessionRetry<T extends { error: unknown }>(
  _supabase: unknown,
  run: () => PromiseLike<T>,
): Promise<T> {
  const first = await run();
  if (!first.error || !isSessionError(first.error)) return first;
  invalidateAccessToken();
  return run();
}
