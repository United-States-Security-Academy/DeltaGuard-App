// Requests from the database (pg_net, pg_cron) carry the shared secret in the
// x-deltaguard-cron-secret header (Vault secret deltaguard_cron_secret, same
// value as this function's CRON_SECRET). Fails closed: without CRON_SECRET
// set, every such request is refused.

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

/** Constant-time comparison (no early exit on the first different byte). */
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** True when the request carries the database's shared secret. */
export function isCronRequest(request: Request): boolean {
  if (CRON_SECRET.length < 32) {
    console.error('CRON_SECRET is not set (or too short): refusing database requests');
    return false;
  }
  return same(request.headers.get('x-deltaguard-cron-secret') ?? '', CRON_SECRET);
}

/** A 401 with no detail, for requests that fail isCronRequest. */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Not allowed' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
