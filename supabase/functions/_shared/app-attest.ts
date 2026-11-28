// Apple App Attest verification (server side), following Apple's
// "Validating apps that connect to your server":
//   https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
//
// Attestation (once per installation, when the app creates its key):
//   1. x5c chain: leaf -> intermediate -> Apple App Attestation Root CA (pinned)
//   2. nonce = SHA256(authData || SHA256(challenge)) equals the leaf
//      certificate's extension 1.2.840.113635.100.8.2
//   3. SHA256(leaf public key, uncompressed point) == keyId
//   4. authData: rpIdHash == SHA256("<TeamID>.<BundleID>"), counter 0,
//      aaguid "appattest" (production) [or "appattestdevelop" if allowed],
//      credentialId == keyId
// Assertion (every later check): the stored public key verifies the ECDSA
// signature over SHA256(authenticatorData || SHA256(challenge)); rpIdHash
// matches; the counter only goes up (replays fail).
//
// The phone (expo @expo/app-integrity) sends SHA256(challenge as UTF-8) as
// clientDataHash, so we hash the same string here.
import * as x509 from 'npm:@peculiar/x509@1.12.3';
import { decode } from 'npm:cbor-x@1.6.0';

import { APPLE_APP_ATTEST_ROOT_PEM } from './apple-app-attest-root.ts';

x509.cryptoProvider.set(crypto);

const NONCE_OID = '1.2.840.113635.100.8.2';
const enc = new TextEncoder();

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function fromBase64(value: string): Uint8Array {
  const normal = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const uint32 = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** AAGUIDs: "appattest" + 7 zero bytes (production), "appattestdevelop" (development). */
const AAGUID_PRODUCTION = concat(enc.encode('appattest'), new Uint8Array(7));
const AAGUID_DEVELOPMENT = enc.encode('appattestdevelop');

export type AttestationResult =
  | { ok: true; publicKeyJwk: JsonWebKey; counter: number }
  | { ok: false; reason: string };

export async function verifyAttestation(input: {
  attestation: string;
  keyId: string;
  challenge: string;
  appId: string;
  allowDevelopment: boolean;
}): Promise<AttestationResult> {
  let att: { fmt?: string; attStmt?: { x5c?: Uint8Array[] }; authData?: Uint8Array };
  try {
    att = decode(fromBase64(input.attestation));
  } catch {
    return { ok: false, reason: 'attestation_unreadable' };
  }
  const x5c = att.attStmt?.x5c;
  const authData = att.authData;
  if (att.fmt !== 'apple-appattest' || !x5c || x5c.length < 2 || !authData) {
    return { ok: false, reason: 'attestation_format' };
  }

  // 1. Certificate chain to the pinned Apple root.
  const root = new x509.X509Certificate(APPLE_APP_ATTEST_ROOT_PEM);
  const leaf = new x509.X509Certificate(x5c[0]!);
  const intermediate = new x509.X509Certificate(x5c[1]!);
  const now = new Date();
  const chainOk =
    (await leaf.verify({ publicKey: intermediate, date: now })) &&
    (await intermediate.verify({ publicKey: root, date: now })) &&
    (await root.verify({ publicKey: root, date: now }));
  if (!chainOk) return { ok: false, reason: 'attestation_chain' };

  // 2. Nonce in the leaf certificate.
  const nonce = await sha256(concat(authData, await sha256(enc.encode(input.challenge))));
  const ext = leaf.getExtension(NONCE_OID);
  if (!ext) return { ok: false, reason: 'attestation_nonce_missing' };
  const value = new Uint8Array(ext.value);
  // SEQUENCE { [1] { OCTET STRING (32) } }
  const prefix = new Uint8Array([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]);
  if (value.length !== 38 || !equal(value.subarray(0, 6), prefix) || !equal(value.subarray(6), nonce)) {
    return { ok: false, reason: 'attestation_nonce' };
  }

  // 3. The key in the certificate is the app's key.
  const key = await leaf.publicKey.export({ name: 'ECDSA', namedCurve: 'P-256' }, ['verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const keyId = fromBase64(input.keyId);
  if (!equal(await sha256(raw), keyId)) return { ok: false, reason: 'attestation_key_id' };

  // 4. Authenticator data.
  if (authData.length < 55) return { ok: false, reason: 'attestation_auth_data' };
  if (!equal(authData.subarray(0, 32), await sha256(enc.encode(input.appId)))) {
    return { ok: false, reason: 'attestation_app_id' };
  }
  if (uint32(authData, 33) !== 0) return { ok: false, reason: 'attestation_counter' };
  const aaguid = authData.subarray(37, 53);
  const production = equal(aaguid, AAGUID_PRODUCTION);
  if (!production && !(input.allowDevelopment && equal(aaguid, AAGUID_DEVELOPMENT))) {
    return { ok: false, reason: 'attestation_environment' };
  }
  const credLength = (authData[53]! << 8) | authData[54]!;
  if (!equal(authData.subarray(55, 55 + credLength), keyId)) {
    return { ok: false, reason: 'attestation_credential_id' };
  }

  return { ok: true, publicKeyJwk: await crypto.subtle.exportKey('jwk', key), counter: 0 };
}

/** DER ECDSA signature -> raw r||s (64 bytes) for WebCrypto. */
function derToRaw(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let i = 2;
  const read = () => {
    if (der[i] !== 0x02) return null;
    const len = der[i + 1]!;
    let int = der.subarray(i + 2, i + 2 + len);
    i += 2 + len;
    while (int.length > 32 && int[0] === 0) int = int.subarray(1);
    if (int.length > 32) return null;
    const out = new Uint8Array(32);
    out.set(int, 32 - int.length);
    return out;
  };
  const r = read();
  const s = read();
  return r && s ? concat(r, s) : null;
}

export type AssertionResult = { ok: true; counter: number } | { ok: false; reason: string };

export async function verifyAssertion(input: {
  assertion: string;
  challenge: string;
  appId: string;
  publicKeyJwk: JsonWebKey;
  previousCounter: number;
}): Promise<AssertionResult> {
  let a: { signature?: Uint8Array; authenticatorData?: Uint8Array };
  try {
    a = decode(fromBase64(input.assertion));
  } catch {
    return { ok: false, reason: 'assertion_unreadable' };
  }
  if (!a.signature || !a.authenticatorData || a.authenticatorData.length < 37) {
    return { ok: false, reason: 'assertion_format' };
  }
  const nonce = await sha256(concat(a.authenticatorData, await sha256(enc.encode(input.challenge))));
  const key = await crypto.subtle.importKey(
    'jwk',
    input.publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signature = derToRaw(a.signature);
  if (!signature) return { ok: false, reason: 'assertion_signature_format' };
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, nonce);
  if (!valid) return { ok: false, reason: 'assertion_signature' };
  if (!equal(a.authenticatorData.subarray(0, 32), await sha256(enc.encode(input.appId)))) {
    return { ok: false, reason: 'assertion_app_id' };
  }
  const counter = uint32(a.authenticatorData, 33);
  if (counter <= input.previousCounter) return { ok: false, reason: 'assertion_replayed' };
  return { ok: true, counter };
}
