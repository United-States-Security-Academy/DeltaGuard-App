// device-integrity: tells genuine DeltaGuard installs on genuine phones apart
// from modified apps, scripts and rooted / emulated devices.
//
// Called by the phone with the officer's access token (verified here with
// getClaims + the live profile; deployed with verify_jwt = false like the
// other functions):
//   { "action": "challenge", "device_id": "…" }
//       -> { challenge }  single use, 5 minutes, bound to this user + phone
//   { "action": "verify", "device_id", "challenge", "platform",
//     "ios": { "key_id", "attestation" | "assertion" },
//     "android": { "token" },
//     "unsupported": true,            // the phone can't run the check
//     "signals": { "rooted", "emulator", "mock_location" } }
//       -> { status, reasons }  (or 409 { need_attestation } when the
//          phone's App Attest key isn't known yet)
// The verdict is recorded on the officer's registered device with
// record_device_integrity(), which flags failures and signals to supervisors.
//
// Secrets (supabase secrets set …):
//   APPLE_TEAM_ID                  iOS: Team ID (App ID = TEAMID.bundle id)
//   IOS_BUNDLE_ID                  default com.deltaconsecurity.deltaguard
//   APP_ATTEST_ALLOW_DEVELOPMENT   "1" to accept development-environment keys
//   GOOGLE_SERVICE_ACCOUNT_JSON    Android: service account linked in Play Console
//   ANDROID_PACKAGE                default com.deltaconsecurity.deltaguard
//   ANDROID_CERT_SHA256            optional, comma-separated base64 SHA-256 of
//                                  the app signing certificate(s)
// Without them the platform's checks are recorded as "unavailable" (flagged,
// never blocked).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4.6.7';

import { verifyAssertion, verifyAttestation } from '../_shared/app-attest.ts';
import { decodeIntegrityToken, judgeVerdict } from '../_shared/play-integrity.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APPLE_TEAM_ID = Deno.env.get('APPLE_TEAM_ID') ?? '';
const IOS_BUNDLE_ID = Deno.env.get('IOS_BUNDLE_ID') ?? 'com.deltaconsecurity.deltaguard';
const ALLOW_DEVELOPMENT = Deno.env.get('APP_ATTEST_ALLOW_DEVELOPMENT') === '1';
const GOOGLE_SA = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '';
const ANDROID_PACKAGE = Deno.env.get('ANDROID_PACKAGE') ?? 'com.deltaconsecurity.deltaguard';
const CERT_DIGESTS = (Deno.env.get('ANDROID_CERT_SHA256') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** Most challenges one user may ask for per hour. */
const CHALLENGES_PER_HOUR = 30;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

const deviceId = z.string().min(1).max(200);
const challengeSchema = z.object({ action: z.literal('challenge'), device_id: deviceId });
const verifySchema = z.object({
  action: z.literal('verify'),
  device_id: deviceId,
  challenge: z.string().min(32).max(128),
  platform: z.enum(['ios', 'android']),
  ios: z
    .object({
      key_id: z.string().min(1).max(200),
      attestation: z.string().max(20_000).optional(),
      assertion: z.string().max(5_000).optional(),
    })
    .optional(),
  android: z.object({ token: z.string().min(1).max(20_000) }).optional(),
  unsupported: z.boolean().optional(),
  signals: z
    .object({
      rooted: z.boolean().optional(),
      emulator: z.boolean().optional(),
      mock_location: z.boolean().optional(),
    })
    .default({}),
});

/** The signed-in, active user; null otherwise. */
async function caller(request: Request): Promise<string | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || typeof sub !== 'string') return null;
  const { data: profile } = await admin
    .from('profiles')
    .select('employment_status')
    .eq('id', sub)
    .maybeSingle();
  return profile?.employment_status === 'active' ? sub : null;
}

async function registeredDevice(userId: string, device: string) {
  const { data } = await admin
    .from('user_devices')
    .select('id, attest_key_id, attest_public_key, attest_counter')
    .eq('user_id', userId)
    .eq('device_id', device)
    .is('revoked_at', null)
    .maybeSingle();
  return data;
}

function randomChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function issueChallenge(userId: string, device: string): Promise<Response> {
  if (!(await registeredDevice(userId, device))) return json({ error: 'Not your registered phone' }, 403);
  const { count } = await admin
    .from('device_integrity_challenges')
    .select('challenge', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= CHALLENGES_PER_HOUR) return json({ error: 'Too many checks. Try later.' }, 429);
  const challenge = randomChallenge();
  const { error } = await admin
    .from('device_integrity_challenges')
    .insert({ challenge, user_id: userId, device_id: device });
  if (error) {
    console.error('device-integrity: challenge insert failed', error.code);
    return json({ error: 'Could not start the check' }, 500);
  }
  return json({ challenge });
}

async function verify(userId: string, input: z.infer<typeof verifySchema>): Promise<Response> {
  // Single use: claimed atomically, only by its owner, only while fresh.
  const { data: claimed } = await admin
    .from('device_integrity_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('challenge', input.challenge)
    .eq('user_id', userId)
    .eq('device_id', input.device_id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('challenge');
  if (!claimed?.length) return json({ error: 'Challenge invalid or expired' }, 400);

  const device = await registeredDevice(userId, input.device_id);
  if (!device) return json({ error: 'Not your registered phone' }, 403);

  const signals = Object.entries(input.signals)
    .filter(([, on]) => on)
    .map(([name]) => name);
  let status: 'verified' | 'failed' | 'unavailable';
  let reasons: string[] = [];

  if (input.unsupported) {
    status = 'unavailable';
    reasons = ['not_supported_on_device'];
  } else if (input.platform === 'ios') {
    if (!APPLE_TEAM_ID) {
      status = 'unavailable';
      reasons = ['not_configured'];
    } else if (!input.ios) {
      status = 'failed';
      reasons = ['missing_attestation'];
    } else {
      const appId = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;
      if (input.ios.attestation) {
        const r = await verifyAttestation({
          attestation: input.ios.attestation,
          keyId: input.ios.key_id,
          challenge: input.challenge,
          appId,
          allowDevelopment: ALLOW_DEVELOPMENT,
        });
        if (r.ok) {
          await admin.rpc('save_attest_key', {
            p_user_id: userId,
            p_device_id: input.device_id,
            p_key_id: input.ios.key_id,
            p_public_key: r.publicKeyJwk,
            p_counter: r.counter,
          });
          status = 'verified';
        } else {
          status = 'failed';
          reasons = [r.reason];
        }
      } else if (input.ios.assertion) {
        if (device.attest_key_id !== input.ios.key_id || !device.attest_public_key) {
          // Unknown key (new install, or the phone was reset): attest afresh.
          return json({ need_attestation: true }, 409);
        }
        const r = await verifyAssertion({
          assertion: input.ios.assertion,
          challenge: input.challenge,
          appId,
          publicKeyJwk: device.attest_public_key as JsonWebKey,
          previousCounter: Number(device.attest_counter ?? 0),
        });
        if (r.ok) {
          await admin.rpc('save_attest_key', {
            p_user_id: userId,
            p_device_id: input.device_id,
            p_key_id: input.ios.key_id,
            p_public_key: device.attest_public_key,
            p_counter: r.counter,
          });
          status = 'verified';
        } else {
          status = 'failed';
          reasons = [r.reason];
        }
      } else {
        status = 'failed';
        reasons = ['missing_attestation'];
      }
    }
  } else if (!GOOGLE_SA) {
    status = 'unavailable';
    reasons = ['not_configured'];
  } else if (!input.android) {
    status = 'failed';
    reasons = ['missing_token'];
  } else {
    try {
      const verdict = await decodeIntegrityToken(input.android.token, GOOGLE_SA, ANDROID_PACKAGE);
      reasons = judgeVerdict(verdict, {
        packageName: ANDROID_PACKAGE,
        challenge: input.challenge,
        certDigests: CERT_DIGESTS,
      });
      status = reasons.length ? 'failed' : 'verified';
    } catch (e) {
      // Google unreachable or misconfigured: not the officer's fault.
      console.error('device-integrity: Play Integrity unavailable', (e as Error).message);
      status = 'unavailable';
      reasons = ['service_unreachable'];
    }
  }

  const { error } = await admin.rpc('record_device_integrity', {
    p_user_id: userId,
    p_device_id: input.device_id,
    p_status: status,
    p_reasons: reasons,
    p_signals: signals,
  });
  if (error) {
    console.error('device-integrity: record failed', error.code);
    return json({ error: 'Could not record the check' }, 500);
  }
  return json({ status, reasons });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  try {
    const userId = await caller(request);
    if (!userId) return json({ error: 'Sign in again' }, 401);
    const body = await request.json().catch(() => null);
    const challenge = challengeSchema.safeParse(body);
    if (challenge.success) return await issueChallenge(userId, challenge.data.device_id);
    const v = verifySchema.safeParse(body);
    if (v.success) return await verify(userId, v.data);
    return json({ error: 'Invalid request' }, 400);
  } catch (e) {
    console.error('device-integrity', (e as Error).name);
    return json({ error: 'Check failed' }, 500);
  }
});
