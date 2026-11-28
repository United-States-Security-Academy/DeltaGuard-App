// Run after `next build`: proves no secret or internal value reached the
// browser bundle (.next/static, everything a browser can download).
//
//   node scripts/check-bundle-secrets.mjs      (exit 1 on any finding)
//
// Looks for:
//   * the VALUES of every non-public env var in .env, .env.local and the
//     process environment (anything not starting with NEXT_PUBLIC_), e.g. the
//     service role key, Resend / Twilio tokens, CRON_SECRET;
//   * any JWT whose payload says role "service_role" (or anything but anon);
//   * Supabase secret API keys (sb_secret_...) and the NAMES of server-only
//     settings (SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, Vault secret names...);
//   * internal addresses (localhost, 127.0.0.1, private IP ranges, *.internal).
// Never prints a secret: only where it was found.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const staticDir = join(root, '.next', 'static');
if (!existsSync(staticDir)) {
  console.error('No .next/static: run `next build` first.');
  process.exit(2);
}

function envFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = { ...envFile('.env'), ...envFile('.env.local'), ...process.env };
const secretValues = Object.entries(env)
  .filter(([key, value]) => !key.startsWith('NEXT_PUBLIC_') && typeof value === 'string')
  .filter(([key]) => /KEY|SECRET|TOKEN|PASSWORD|PRIVATE|DSN|URL|SID/.test(key))
  .filter(([, value]) => value.length >= 12)
  // Values that are also public (e.g. the same Supabase URL) aren't secrets.
  .filter(
    ([, value]) =>
      !Object.entries(env).some(([k, v]) => k.startsWith('NEXT_PUBLIC_') && v === value),
  );

const NAME_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /\bservice_role_key\b/i,
  /sb_secret_[A-Za-z0-9_-]{8,}/,
  /CRON_SECRET/,
  /deltaguard_cron_secret/,
  /deltaguard_functions_url/,
  /RESEND_API_KEY/,
  /TWILIO_AUTH_TOKEN/,
  /SEND_EMAIL_HOOK_SECRET/,
  /x-deltaguard-cron-secret/,
];
const INTERNAL_PATTERNS = [
  /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/,
  /\bhttps?:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/,
  /\b[a-z0-9-]+\.internal\b/,
  /\bpostgres(ql)?:\/\/[^\s"']+/,
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

function jwtRoles(text) {
  const roles = [];
  for (const m of text.matchAll(
    /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g,
  )) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      roles.push(String(payload.role ?? 'unknown'));
    } catch {
      roles.push('unreadable');
    }
  }
  return roles;
}

/** Library constants that look internal but aren't ours (checked by hand). */
const ALLOWED = [
  // @supabase/auth-js: its built-in default GoTrue URL, overridden by our project URL.
  'url:"http://localhost:9999"',
];
const withoutAllowed = (text) => ALLOWED.reduce((t, a) => t.split(a).join(''), text);

const findings = [];
let scanned = 0;
for (const path of files(staticDir)) {
  if (!/\.(js|mjs|css|json|html|txt|map)$/.test(path)) continue;
  const text = withoutAllowed(readFileSync(path, 'utf8'));
  scanned++;
  const where = path.slice(root.length);
  for (const [key, value] of secretValues) {
    if (text.includes(value)) findings.push(`${where}: value of ${key}`);
  }
  for (const re of NAME_PATTERNS) if (re.test(text)) findings.push(`${where}: matches ${re}`);
  for (const re of INTERNAL_PATTERNS)
    if (re.test(text)) findings.push(`${where}: internal address ${re}`);
  for (const role of jwtRoles(text)) {
    if (role !== 'anon') findings.push(`${where}: a JWT with role "${role}"`);
  }
}

console.log(
  `Scanned ${scanned} browser files for ${secretValues.length} secret values, ` +
    `${NAME_PATTERNS.length} secret names and ${INTERNAL_PATTERNS.length} internal-address patterns.`,
);
if (findings.length) {
  console.error(`FOUND ${findings.length}:\n  ${findings.join('\n  ')}`);
  process.exit(1);
}
console.log('No secrets, service-role tokens or internal addresses in the browser bundle.');
