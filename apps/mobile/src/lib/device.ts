import type { DevicePlatform } from '@deltaguard/shared';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// A random id that identifies this install on this phone. Neither iOS nor
// Android offers a stable cross-platform hardware id, and we don't want one:
// a random value reveals nothing about the phone.
const DEVICE_ID_KEY = 'deltaguard.device_id';

// THIS_DEVICE_ONLY: the id is never copied to another iPhone through an
// iCloud/encrypted backup, so restoring a backup onto a new phone does not
// clone this phone's registration.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** This phone's device id, created on first use. Kept across sign-outs. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY, options);
  if (existing) return existing;

  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id, options);
  return id;
}

export function currentPlatform(): DevicePlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}
