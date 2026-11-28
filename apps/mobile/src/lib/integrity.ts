import * as AppIntegrity from '@expo/app-integrity';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { getOrCreateDeviceId } from './device';
import { supabase } from './supabase';

// App integrity: proves to the server (Edge Function device-integrity) that
// requests come from our genuine app on a genuine phone, using Apple App
// Attest (iOS) or Google Play Integrity (Android), and reports what the phone
// can see about itself: rooted / jailbroken, emulator, fake-location app.
//
// The server records the verdict on the registered device; supervisors are
// told about failures and signals, and (if an admin chose "block") clock-in,
// quiz submission and form signing are refused from a FAILED phone. Nothing
// here blocks the officer by itself.
//
// Runs on entering the app, every 6 hours while it is open, and at once when
// a fake location is seen. A check that can't run (offline, no Play services,
// not configured) is simply tried again later.

const RECHECK_MS = 6 * 60 * 60 * 1000;
/** Google Cloud project number linked to the app in Play Console (not a secret). */
const PLAY_CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER;
/** This installation's App Attest key id (iOS). Survives sign-outs: it belongs to the install. */
const ATTEST_KEY = 'deltaguard.app_attest_key';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let lastCheck = 0;
let running: Promise<void> | null = null;
let mockLocationSeen = false;
let playPrepared = false;

/** Called when a location fix comes from a mock-location app (location.ts). */
export function reportMockLocation(): void {
  mockLocationSeen = true;
  void checkDeviceIntegrity({ force: true });
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('device-integrity', { body });
  if (error instanceof FunctionsHttpError) {
    return { data: null, status: error.context.status as number };
  }
  if (error) throw error;
  return { data: data as Record<string, unknown>, status: 200 };
}

async function signals() {
  const rooted = await Device.isRootedExperimentalAsync().catch(() => false);
  return { rooted, emulator: !Device.isDevice, mock_location: mockLocationSeen };
}

/** Proof for one challenge: App Attest (iOS) or a Play Integrity token (Android). */
async function proof(challenge: string, freshKey: boolean): Promise<Record<string, unknown>> {
  if (Platform.OS === 'ios') {
    if (!AppIntegrity.isSupported) return { unsupported: true };
    let keyId = freshKey ? null : await SecureStore.getItemAsync(ATTEST_KEY, KEY_OPTIONS);
    if (!keyId) {
      keyId = await AppIntegrity.generateKeyAsync();
      await SecureStore.setItemAsync(ATTEST_KEY, keyId, KEY_OPTIONS);
      return { ios: { key_id: keyId, attestation: await AppIntegrity.attestKeyAsync(keyId, challenge) } };
    }
    return { ios: { key_id: keyId, assertion: await AppIntegrity.generateAssertionAsync(keyId, challenge) } };
  }
  if (Platform.OS === 'android') {
    if (!PLAY_CLOUD_PROJECT_NUMBER) return { unsupported: true };
    try {
      if (!playPrepared) {
        await AppIntegrity.prepareIntegrityTokenProviderAsync(PLAY_CLOUD_PROJECT_NUMBER);
        playPrepared = true;
      }
      return { android: { token: await AppIntegrity.requestIntegrityCheckAsync(challenge) } };
    } catch {
      playPrepared = false;
      // No Play services / Play Store (or Google unreachable): the server
      // records "unavailable" and the device signals still count.
      return { unsupported: true };
    }
  }
  return { unsupported: true };
}

async function runCheck(): Promise<void> {
  const device_id = await getOrCreateDeviceId();
  for (let attempt = 0; attempt < 2; attempt++) {
    const issued = await invoke({ action: 'challenge', device_id });
    const challenge = issued.data?.challenge;
    if (typeof challenge !== 'string') return;
    const result = await invoke({
      action: 'verify',
      device_id,
      challenge,
      platform: Platform.OS,
      signals: await signals(),
      ...(await proof(challenge, attempt > 0)),
    });
    // The server doesn't know this App Attest key (new install, phone reset):
    // make a new one and attest it.
    if (result.status === 409) continue;
    if (result.status === 200) mockLocationSeen = false;
    return;
  }
}

/** Runs a check unless one ran in the last 6 hours (or `force`). Never throws. */
export function checkDeviceIntegrity({ force = false } = {}): Promise<void> {
  if (running) return running;
  if (!force && Date.now() - lastCheck < RECHECK_MS) return Promise.resolve();
  running = runCheck()
    .then(() => {
      lastCheck = Date.now();
    })
    .catch(() => undefined) // offline / server down: next time
    .finally(() => {
      running = null;
    });
  return running;
}

/** Mounted once inside the signed-in app. */
export function useDeviceIntegrity(): void {
  useEffect(() => {
    void checkDeviceIntegrity();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkDeviceIntegrity();
    });
    return () => sub.remove();
  }, []);
}
