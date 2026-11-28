// Turning errors from Supabase (PostgREST, Auth, Storage, fetch) into words an
// officer or admin can act on. Raw database text ("permission denied for
// function …") is never shown: it is logged by the caller instead.

export type ErrorKind =
  /** No connection, or it dropped mid-request. Trying again later will work. */
  | 'offline'
  /** The sign-in token expired or couldn't be renewed (often after being offline). */
  | 'session'
  /** The server refused: not allowed for this user. */
  | 'denied'
  /** A message our own database functions raise on purpose; safe to show as is. */
  | 'app'
  | 'unknown';

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  details?: unknown;
};

const OFFLINE_PATTERN =
  /network request failed|failed to fetch|networkerror|load failed|network connection was lost|internet connection appears to be offline|timed? ?out|aborted|ECONNRESET|ENOTFOUND|EAI_AGAIN/i;

const SESSION_PATTERN =
  /jwt expired|invalid jwt|jwt.*malformed|auth session missing|refresh token|not authenticated|invalid claim/i;

/** SQLSTATEs our own functions raise with a message written for people. */
const APP_CODES = new Set([
  'P0001',
  'P0002',
  '22023',
  'DG001',
  'DG002',
  'DG010',
  'DG011',
  'DG012',
  'DG020', // phone failed the integrity check, block mode (phase 20)
  'DG429', // rate limited (phase 18)
]);

function fields(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {};
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

export function errorKind(error: unknown): ErrorKind {
  if (error === null || error === undefined) return 'unknown';
  const e = fields(error);
  const name = str(e.name);
  const message = typeof error === 'string' ? error : str(e.message);
  const details = str(e.details);
  const code = str(e.code);
  const status = Number(e.status ?? e.statusCode) || 0;

  if (
    name === 'AuthRetryableFetchError' ||
    (name === 'TypeError' && OFFLINE_PATTERN.test(message)) ||
    OFFLINE_PATTERN.test(message) ||
    OFFLINE_PATTERN.test(details)
  ) {
    return 'offline';
  }
  if (
    code.startsWith('PGRST30') || // JWT missing, expired or invalid
    status === 401 ||
    SESSION_PATTERN.test(message) ||
    // Every table and function is granted to signed-in users, so "permission
    // denied for function/table" means the request went out without a valid
    // sign-in (the anonymous role), not that this user lacks a right.
    /permission denied for (function|table|schema|relation|sequence)/i.test(message)
  ) {
    return 'session';
  }
  if (code === '42501' || status === 403) return 'denied';
  if (APP_CODES.has(code) && message) return 'app';
  return 'unknown';
}

export type FriendlyErrorOptions = {
  /** What was being done, e.g. "load your conversations" → "Couldn't load your conversations." */
  action?: string;
  /** How to recover from an expired sign-in in this app. */
  sessionHint?: string;
};

const DEFAULT_SESSION_HINT = 'Try again. If it keeps happening, sign out and sign back in.';

/** A sentence or two to show the user. */
export function friendlyError(error: unknown, options: FriendlyErrorOptions = {}): string {
  const lead = options.action ? `Couldn’t ${options.action}. ` : '';
  switch (errorKind(error)) {
    case 'offline':
      return `${lead}You seem to be offline. Check your signal or Wi-Fi and try again.`;
    case 'session':
      return `${lead}Your sign-in needs refreshing. ${options.sessionHint ?? DEFAULT_SESSION_HINT}`;
    case 'denied':
      return `${lead}You don’t have permission to do that.`;
    case 'app': {
      const message = str(fields(error).message).trim();
      return `${lead}${message}${/[.!?]$/.test(message) ? '' : '.'}`;
    }
    default:
      return `${lead}Something went wrong. Please try again.`;
  }
}

/** True when trying again after the connection returns is the right fix. */
export const isOfflineError = (error: unknown) => errorKind(error) === 'offline';
/** True when renewing the sign-in and trying again may fix it. */
export const isSessionError = (error: unknown) => errorKind(error) === 'session';
