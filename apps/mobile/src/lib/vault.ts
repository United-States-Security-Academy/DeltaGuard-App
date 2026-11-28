import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

// Encryption at rest for everything an officer drafts or queues on the phone:
// incident reports and their photos, forms and signatures, quiz answers,
// training and welfare state.
//
//   * AES-256-GCM (@noble/ciphers: audited, pure JS), a fresh random 96-bit
//     nonce per write; tampered or truncated files fail to decrypt.
//   * One random 256-bit key per user, kept in the Keychain / Keystore
//     (expo-secure-store), this device only, never in backups. The files are
//     useless without it: a backup, a copied app folder or a rooted dump of
//     the files shows nothing.
//   * Signing out (or a device reset / termination) deletes the key first,
//     so even a file that couldn't be deleted can never be read again.
//
// File format: "DGV1" | nonce (12) | ciphertext + tag (16). Older plaintext
// files (before this change) are still read and are encrypted on next write.

const MAGIC = utf8ToBytes('DGV1');
const NONCE_BYTES = 12;
/** Readable after the first unlock since boot (welfare alarms can open the app on a locked phone). */
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const keyName = (userId: string) => `deltaguard.vault.${userId}`;
const keys = new Map<string, Promise<Uint8Array>>();

function vaultKey(userId: string): Promise<Uint8Array> {
  let key = keys.get(userId);
  if (!key) {
    key = (async () => {
      const stored = await SecureStore.getItemAsync(keyName(userId), KEY_OPTIONS);
      if (stored) return hexToBytes(stored);
      const fresh = Crypto.getRandomBytes(32);
      await SecureStore.setItemAsync(keyName(userId), bytesToHex(fresh), KEY_OPTIONS);
      return fresh;
    })();
    key.catch(() => keys.delete(userId));
    keys.set(userId, key);
  }
  return key;
}

/** Deletes the user's key: everything encrypted with it becomes unreadable. */
export async function destroyVaultKey(userId: string): Promise<void> {
  keys.delete(userId);
  await SecureStore.deleteItemAsync(keyName(userId), KEY_OPTIONS).catch(() => undefined);
}

function isEncrypted(data: Uint8Array): boolean {
  return data.length > MAGIC.length + NONCE_BYTES && MAGIC.every((b, i) => data[i] === b);
}

export async function encryptBytes(userId: string, plain: Uint8Array): Promise<Uint8Array> {
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const sealed = gcm(await vaultKey(userId), nonce).encrypt(plain);
  const out = new Uint8Array(MAGIC.length + NONCE_BYTES + sealed.length);
  out.set(MAGIC, 0);
  out.set(nonce, MAGIC.length);
  out.set(sealed, MAGIC.length + NONCE_BYTES);
  return out;
}

/** Decrypts; a pre-encryption plaintext file is returned as it is. Throws if tampered. */
export async function decryptBytes(userId: string, data: Uint8Array): Promise<Uint8Array> {
  if (!isEncrypted(data)) return data;
  const nonce = data.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
  return gcm(await vaultKey(userId), nonce).decrypt(data.subarray(MAGIC.length + NONCE_BYTES));
}

/** Encrypts `text` into `file` (written to a temp file, then swapped in). */
export async function writeEncryptedText(file: File, userId: string, text: string): Promise<void> {
  await writeEncryptedBytes(file, userId, utf8ToBytes(text));
}

export async function writeEncryptedBytes(
  file: File,
  userId: string,
  plain: Uint8Array,
): Promise<void> {
  const sealed = await encryptBytes(userId, plain);
  const tmp = new File(file.parentDirectory, `${file.name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  await tmp.write(sealed);
  await tmp.move(file, { overwrite: true });
}

export async function readEncryptedText(file: File, userId: string): Promise<string> {
  return bytesToUtf8(await decryptBytes(userId, await file.bytes()));
}

export async function readEncryptedBytes(uri: string, userId: string): Promise<Uint8Array> {
  return decryptBytes(userId, await new File(uri).bytes());
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A displayable image URI for a local file: decrypted into memory (data URI), never to disk. */
export async function imageDataUri(uri: string, userId: string, mime: string): Promise<string> {
  if (!uri.endsWith('.enc')) return uri;
  return `data:${mime};base64,${toBase64(await readEncryptedBytes(uri, userId))}`;
}
