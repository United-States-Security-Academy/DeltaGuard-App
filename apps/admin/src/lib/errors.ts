import { friendlyError, isSessionError } from '@deltaguard/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// Error wording for the console's browser code. Raw database text is logged to
// the browser console, never shown.

const SESSION_HINT = 'Refresh the page. If it keeps happening, sign out and sign back in.';

/** A sentence to show for a failed request, e.g. consoleError(e, 'load conversations'). */
export function consoleError(error: unknown, action?: string): string {
  console.warn(action ? `Couldn't ${action}:` : 'Request failed:', error);
  return friendlyError(error, { action, sessionHint: SESSION_HINT });
}

/**
 * Runs a Supabase request; if it failed because the sign-in had expired (often
 * after the internet dropped, so the token couldn't be renewed and the request
 * went out signed out), renews the session and runs it once more.
 */
export async function withSessionRetry<T extends { error: unknown }>(
  supabase: SupabaseClient,
  run: () => PromiseLike<T>,
): Promise<T> {
  const first = await run();
  if (!first.error || !isSessionError(first.error)) return first;
  const { error } = await supabase.auth.refreshSession();
  return error ? first : run();
}
