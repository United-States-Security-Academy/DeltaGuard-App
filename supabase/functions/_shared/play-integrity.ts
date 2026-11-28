// Google Play Integrity (Standard API) verification, server side.
//
// The phone asks Play for a token bound to our challenge (requestHash). We
// decrypt and verify it with Google's decodeIntegrityToken endpoint, using a
// Google Cloud service account linked to the app in Play Console, then judge
// the verdict ourselves:
//   * the request: our package, our challenge, made in the last 5 minutes;
//   * appIntegrity: PLAY_RECOGNIZED (installed from Play, not modified), and
//     signed with our certificate (if ANDROID_CERT_SHA256 is set);
//   * deviceIntegrity: MEETS_DEVICE_INTEGRITY (a genuine, non-rooted Android
//     device with Play services; fails on most rooted phones and emulators).
// Docs: https://developer.android.com/google/play/integrity/verdicts

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

let cached: { token: string; expires: number } | null = null;

/** An OAuth access token for the Play Integrity API (cached until near expiry). */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expires - 60 > Date.now() / 1000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      await importPrivateKey(sa.private_key),
      new TextEncoder().encode(`${header}.${claims}`),
    ),
  );
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`google_oauth_${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: now + body.expires_in };
  return body.access_token;
}

export type PlayVerdict = {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
    certificateSha256Digest?: string[];
  };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
};

/** Decrypts and verifies a token with Google. Throws if Google can't be reached. */
export async function decodeIntegrityToken(
  token: string,
  serviceAccountJson: string,
  packageName: string,
): Promise<PlayVerdict> {
  const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken(sa)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrity_token: token }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (res.status === 400) return {}; // malformed / forged token: judged as failing
  if (!res.ok) throw new Error(`play_integrity_${res.status}`);
  const body = (await res.json()) as { tokenPayloadExternal?: PlayVerdict };
  return body.tokenPayloadExternal ?? {};
}

/** Reasons the verdict fails (empty = genuine app on a genuine device). */
export function judgeVerdict(
  v: PlayVerdict,
  expected: { packageName: string; challenge: string; certDigests: string[] },
): string[] {
  const reasons: string[] = [];
  const req = v.requestDetails ?? {};
  if (req.requestPackageName !== expected.packageName) reasons.push('wrong_package');
  if (req.requestHash !== expected.challenge) reasons.push('wrong_challenge');
  const age = Date.now() - Number(req.timestampMillis ?? 0);
  if (!(age >= -60_000 && age <= 5 * 60_000)) reasons.push('stale_token');

  const app = v.appIntegrity ?? {};
  if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED') reasons.push('app_not_recognized');
  if (app.packageName && app.packageName !== expected.packageName) reasons.push('wrong_package');
  if (expected.certDigests.length) {
    const digests = (app.certificateSha256Digest ?? []).map((d) => d.replace(/=+$/, ''));
    if (!expected.certDigests.some((d) => digests.includes(d.replace(/=+$/, '')))) {
      reasons.push('wrong_signing_certificate');
    }
  }
  const device = v.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  if (!device.includes('MEETS_DEVICE_INTEGRITY')) reasons.push('device_integrity');
  return [...new Set(reasons)];
}
