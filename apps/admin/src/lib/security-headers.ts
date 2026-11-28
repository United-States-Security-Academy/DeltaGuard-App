// Security headers for every console response (plain module: used by the
// proxy for pages and by next.config.ts for everything else).

/** Map tiles (lib/map-layers.ts) and the address search (sites/site-form.tsx). */
const TILE_HOSTS = ['https://tile.openstreetmap.org', 'https://server.arcgisonline.com'];
const GEOCODER_HOSTS = ['https://nominatim.openstreetmap.org'];

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The Content-Security-Policy for a page. Scripts: only this site's, and only
 * with this request's nonce ('strict-dynamic' lets those load their chunks);
 * no 'unsafe-inline', no 'unsafe-eval' outside `next dev`. Network: this
 * site, our Supabase project (HTTPS + Realtime WebSocket), map tiles, the
 * address search, and Sentry if a DSN is configured. No plugins, no framing.
 */
export function contentSecurityPolicy(nonce: string, env: NodeJS.ProcessEnv = process.env): string {
  const dev = env.NODE_ENV === 'development';
  const supabase = origin(env.NEXT_PUBLIC_SUPABASE_URL);
  const realtime = supabase?.replace(/^http/, 'ws') ?? null;
  const sentry = origin(env.NEXT_PUBLIC_SENTRY_DSN ?? env.SENTRY_DSN);
  const list = (...items: (string | null | false)[]) => items.filter(Boolean).join(' ');

  const directives: Record<string, string> = {
    'default-src': "'self'",
    // pdf.js may compile WebAssembly image decoders: 'wasm-unsafe-eval' allows
    // WebAssembly only, not JavaScript eval.
    'script-src': list(
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      dev && "'unsafe-eval'",
    ),
    // Style attributes from React and Leaflet; styles can't run code.
    'style-src': "'self' 'unsafe-inline'",
    'img-src': list("'self'", 'data:', 'blob:', supabase, ...TILE_HOSTS),
    'font-src': "'self'",
    'connect-src': list("'self'", supabase, realtime, ...GEOCODER_HOSTS, sentry),
    // pdf.js worker; the inline PDF preview is a signed Supabase Storage URL.
    'worker-src': "'self' blob:",
    'frame-src': list(supabase),
    'media-src': "'self'",
    'manifest-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
  };
  const policy = Object.entries(directives)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key} ${value}`);
  if (!dev) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/** Headers for every response (pages, route handlers, static files). */
export function staticSecurityHeaders(env: NodeJS.ProcessEnv = process.env): [string, string][] {
  const headers: [string, string][] = [
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    [
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), ' +
        'magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()',
    ],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['X-DNS-Prefetch-Control', 'off'],
  ];
  // HTTPS only: browsers ignore HSTS on plain-HTTP localhost anyway.
  if (env.NODE_ENV === 'production') {
    headers.push(['Strict-Transport-Security', 'max-age=63072000; includeSubDomains']);
  }
  return headers;
}

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
