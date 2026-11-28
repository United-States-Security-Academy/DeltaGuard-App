import { authLinkParamsSchema } from '@deltaguard/shared';

// Every link that opens the app goes through here first (+native-intent.tsx).
// Only our own links are accepted, with every parameter checked; anything
// else opens the home screen. A link never DOES anything by itself: the invite
// screen asks the person to tap Continue, and in-app screens need a signed-in
// (and biometric-unlocked) session, enforced by the root layout.
//
// Accepted:
//   deltaguard://set-password?token_hash=<1-500 safe chars>&type=invite|recovery
//   deltaguard://notifications
//   deltaguard://shifts/<uuid> | forms/<uuid> | training/<uuid> | sos-alert/<uuid>
// Development only: Expo Go (exp://…/--/…) and dev-client launcher links.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMES = new Set(['deltaguard', 'exp+deltaguard']);
const DETAIL_ROUTES = new Set(['shifts', 'forms', 'training', 'sos-alert']);
/** Supabase token hashes: hex / base64url-ish. */
const TOKEN_HASH = /^[A-Za-z0-9_-]{1,500}$/;

/** Splits a URL or path into path segments and query, or null if not ours. */
function parse(input: string, dev: boolean): { segments: string[]; query: URLSearchParams } | null {
  let rest = input.trim();
  const scheme = rest.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    rest = rest.slice(scheme[0].length);
    if (name === 'exp' || name === 'exps') {
      if (!dev) return null;
      const at = rest.indexOf('/--/');
      rest = at >= 0 ? rest.slice(at + 4) : '';
    } else if (!SCHEMES.has(name)) {
      return null; // https://, other apps' schemes, javascript:, file: …
    }
  }
  const q = rest.indexOf('?');
  const path = (q >= 0 ? rest.slice(0, q) : rest).replace(/#.*$/, '');
  const query = new URLSearchParams(q >= 0 ? rest.slice(q + 1).replace(/#.*$/, '') : '');
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return '\u0000'; // malformed escapes never match a route
      }
    });
  return { segments, query };
}

/** The in-app path to open for an incoming link ('/' when it isn't one of ours). */
export function safeAppPath(input: string, dev = false): string {
  // The dev client's own launcher links (development builds only).
  if (dev && /^exp\+deltaguard:\/\/expo-development-client\//i.test(input)) return input;
  const link = parse(input, dev);
  if (!link) return '/';
  const [first, second, ...extra] = link.segments;
  if (extra.length) return '/';

  if (first === 'set-password' && !second) {
    const keys = [...link.query.keys()];
    if (keys.some((k) => k !== 'token_hash' && k !== 'type')) return '/';
    const parsed = authLinkParamsSchema.safeParse({
      token_hash: link.query.get('token_hash'),
      type: link.query.get('type'),
    });
    if (!parsed.success || !TOKEN_HASH.test(parsed.data.token_hash)) return '/';
    return `/set-password?${new URLSearchParams(parsed.data)}`;
  }
  if (first === 'notifications' && !second && [...link.query.keys()].length === 0) {
    return '/notifications';
  }
  if (first && DETAIL_ROUTES.has(first) && second && UUID.test(second)) {
    return `/${first}/${second.toLowerCase()}`;
  }
  return '/';
}
