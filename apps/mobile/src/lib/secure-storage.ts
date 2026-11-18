import * as SecureStore from 'expo-secure-store';

// expo-secure-store saves values in the iOS Keychain / Android Keystore, which
// are encrypted by the OS (unlike AsyncStorage, a plain unencrypted file).
// SecureStore values over 2048 bytes can be rejected and a Supabase session
// is usually bigger, so each value is split across several keys.

// 600 UTF-16 code units is at most 1800 bytes of UTF-8, safely under the limit.
const CHUNK_SIZE = 600;

const countKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

function splitIntoChunks(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + CHUNK_SIZE, value.length);
    // Don't split an emoji (surrogate pair) across two chunks.
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

async function getChunkCount(key: string): Promise<number> {
  const count = await SecureStore.getItemAsync(countKey(key));
  return count ? Number(count) : 0;
}

async function deleteChunks(key: string, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
}

/** Storage adapter matching the interface supabase-js expects for `auth.storage`. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await getChunkCount(key);
    if (count === 0) return null;

    const chunks: string[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
      if (chunk === null) return null; // partially written value: treat as signed out
      chunks.push(chunk);
    }
    return chunks.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousCount = await getChunkCount(key);
    const chunks = splitIntoChunks(value);

    for (const [i, chunk] of chunks.entries()) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunk);
    }
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
    await deleteChunks(key, chunks.length, previousCount);
  },

  async removeItem(key: string): Promise<void> {
    const count = await getChunkCount(key);
    await SecureStore.deleteItemAsync(countKey(key));
    await deleteChunks(key, 0, count);
  },
};
