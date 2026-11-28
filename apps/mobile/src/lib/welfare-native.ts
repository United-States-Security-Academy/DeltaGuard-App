import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// The local Android module in modules/welfare-alarm (full-screen alarm
// notification, showing over the lock screen, media volume). Null on iOS, in
// Expo Go, and in builds made before the module existed: callers fall back to
// plain expo-notifications.

type WelfareAlarmModule = {
  /** true = exact time; false = approximate (no exact-alarm permission). */
  schedule(id: string, atMs: number, title: string, body: string): boolean;
  cancel(id: string): void;
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  showOverLockScreen(on: boolean): void;
  /** Sets media volume to max; returns the previous level. */
  maxMediaVolume(): number;
  restoreMediaVolume(level: number): void;
};

export const welfareNative: WelfareAlarmModule | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<WelfareAlarmModule>('WelfareAlarm')
    : null;

/** Runs a native call, ignoring failures (the JS fallback still works). */
export function tryNative<T>(fn: (m: WelfareAlarmModule) => T): T | null {
  if (!welfareNative) return null;
  try {
    return fn(welfareNative);
  } catch (e) {
    console.warn('WelfareAlarm', e);
    return null;
  }
}
