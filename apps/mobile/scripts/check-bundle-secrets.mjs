// Run after `expo export` (see README): proves the phone's JS bundles carry no
// secret. Hermes bytecode (.hbc) keeps string literals as plain bytes, so they
// can be searched like text.
//
//   node scripts/check-bundle-secrets.mjs [dist]     (exit 1 on any finding)
//
// Allowed in the bundle: EXPO_PUBLIC_* values (the Supabase URL, the anon key,
// the Play Cloud project number), which are public by design.
// Looks for:
//   * the VALUES of every other variable in apps/mobile/.env*, the repo's
//     .env* files and the environment (service role key, tokens, secrets);
//   * any JWT whose payload role isn't "anon";
//   * Supabase secret keys (sb_secret_...), private keys (PEM), and the names
//     of server-only secrets;
//   * internal addresses (localhost, private IPs, *.internal).
// Never prints a secret: only which one and where.
import { Buffer } from 'node:buffer';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(here, process.argv[2] ?? 'dist');
if (!existsSync(dist)) {
  console.error(`No ${dist}: run \`npx expo export\` first.`);
  process.exit(2);
}

function envFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const envFiles = [here, join(here, '..', 'admin'), join(here, '..', '..')].flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => /^\.env/.test(f) && !f.endsWith('.example'))
    .map((f) => join(dir, f)),
);
const env = Object.assign({}, ...envFiles.map(envFile), process.env);
const publicValues = new Set(
  Object.entries(env)
    .filter(([k]) => k.startsWith('EXPO_PUBLIC_') || k.startsWith('NEXT_PUBLIC_'))
    .map(([, v]) => v),
);
const secrets = Object.entries(env)
  .filter(([k, v]) => !k.startsWith('EXPO_PUBLIC_') && !k.startsWith('NEXT_PUBLIC_') && typeof v === 'string')
  .filter(([k]) => /KEY|SECRET|TOKEN|PASSWORD|PRIVATE|SID|DSN|SERVICE/.test(k))
  .filter(([, v]) => v.length >= 12 && !publicValues.has(v));

const PATTERNS = [
  // A real key continues with letters/digits; supabase-js's own "sb_secret_"
  // prefix check is followed by the next string in Hermes's string table.
  [/sb_secret_[A-Za-z0-9]{16,}/, 'Supabase secret key'],
  [/-----BEGIN (RSA |EC |)PRIVATE KEY-----/, 'private key'],
  [/SUPABASE_SERVICE_ROLE_KEY|service_role_key/i, 'service role key name'],
  [/CRON_SECRET|deltaguard_cron_secret|RESEND_API_KEY|TWILIO_AUTH_TOKEN|GOOGLE_SERVICE_ACCOUNT/, 'server secret name'],
  [/"private_key"\s*:/, 'service account JSON'],
  [/\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)[:/]/, 'localhost address'],
  [/\bhttps?:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/, 'private IP address'],
  [/\bpostgres(ql)?:\/\/[^\s"']+/, 'database URL'],
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(hbc|js|bundle|map|json)$/.test(name)) yield p;
  }
}

const findings = [];
const jwtRoles = new Map();
let scanned = 0;
for (const path of files(dist)) {
  const text = readFileSync(path).toString('latin1');
  const where = path.slice(dist.length + 1);
  scanned++;
  for (const [key, value] of secrets) if (text.includes(value)) findings.push(`${where}: value of ${key}`);
  for (const [re, what] of PATTERNS) if (re.test(text)) findings.push(`${where}: ${what}`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    let role = 'unreadable';
    try {
      role = String(JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role);
    } catch {
      // not a JWT payload
    }
    jwtRoles.set(role, (jwtRoles.get(role) ?? 0) + 1);
    if (role !== 'anon') findings.push(`${where}: a JWT with role "${role}"`);
  }
}

const publicInBundle = Object.entries(env)
  .filter(([k]) => k.startsWith('EXPO_PUBLIC_'))
  .map(([k]) => k);
console.log(
  `Scanned ${scanned} bundle files for ${secrets.length} secret values and ${PATTERNS.length} patterns. ` +
    `JWTs found: ${[...jwtRoles].map(([r, n]) => `${n} × role ${r}`).join(', ') || 'none'}. ` +
    `Public values allowed: ${publicInBundle.join(', ') || 'none'}.`,
);
if (findings.length) {
  console.error(`FOUND ${findings.length}:\n  ${[...new Set(findings)].join('\n  ')}`);
  process.exit(1);
}
console.log('Only public values in the bundle: no secrets, service-role tokens, keys or internal addresses.');
