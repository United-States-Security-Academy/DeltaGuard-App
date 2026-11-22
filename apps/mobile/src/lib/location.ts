import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

// One-off location fixes for clock-in, clock-out (and later SOS). Nothing here
// watches the location or runs in the background: each call asks the OS for a
// single fix and stops (CLAUDE.md: location only at clock-in/out and SOS).

export type PermissionCheck =
  /** Already allowed: go straight to the fix. */
  | 'granted'
  /** Never asked (or can ask again): explain why, then ask. */
  | 'ask'
  /** Refused and the OS won't show the prompt again: only Settings can fix it. */
  | 'blocked';

/** Checks the permission without showing any prompt. */
export async function checkLocationPermission(): Promise<PermissionCheck> {
  const p = await Location.getForegroundPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'ask' : 'blocked';
}

/** Shows the OS prompt (foreground / "while using the app" only). */
export async function requestLocationPermission(): Promise<'granted' | 'denied'> {
  const p = await Location.requestForegroundPermissionsAsync();
  return p.granted ? 'granted' : 'denied';
}

export function openAppSettings() {
  void Linking.openSettings().catch(() => undefined);
}

export type Fix = {
  latitude: number;
  longitude: number;
  /** Metres (68% confidence), or null if the phone didn't say. */
  accuracyM: number | null;
  /** The OS reported the position as coming from a mock / spoofing provider. */
  isMock: boolean;
  /** iOS "Precise Location" is off: the position is deliberately blurred. */
  reducedAccuracy: boolean;
};

export type FixResult =
  | { ok: true; fix: Fix }
  | { ok: false; reason: 'services_off' | 'permission' | 'timeout' | 'unavailable' };

/** Give up on a fix after this long (indoors, GPS can take a while). */
const FIX_TIMEOUT_MS = 30_000;

/**
 * One high-accuracy fix. The caller must already have the permission
 * (checkLocationPermission / requestLocationPermission).
 */
export async function getClockFix(): Promise<FixResult> {
  if (!(await Location.hasServicesEnabledAsync())) {
    if (Platform.OS !== 'android') return { ok: false, reason: 'services_off' };
    // Android can show the system "Turn on location" dialog in place.
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      return { ok: false, reason: 'services_off' };
    }
  }

  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: 'permission' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), FIX_TIMEOUT_MS);
      }),
    ]);
    if (position === 'timeout') return { ok: false, reason: 'timeout' };

    const { latitude, longitude, accuracy } = position.coords;
    return {
      ok: true,
      fix: {
        latitude,
        longitude,
        accuracyM: accuracy !== null && accuracy >= 0 ? accuracy : null,
        // Android sets `mocked` for positions from a mock-location app; recent
        // iOS versions also set it for simulated locations.
        isMock: position.mocked === true,
        reducedAccuracy: permission.ios?.accuracy === 'reduced',
      },
    };
  } catch {
    // No fix possible (e.g. GPS hardware off, airplane mode with no providers).
    return { ok: false, reason: 'unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
