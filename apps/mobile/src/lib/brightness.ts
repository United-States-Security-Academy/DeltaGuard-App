import * as Brightness from 'expo-brightness';
import { Platform } from 'react-native';

// Screen brightness for the duty screen (dimmed) and the welfare prompt (full).
// Android changes only this app's window, and restoring hands control back to
// the system setting. iOS changes the screen itself, so the level the officer
// had is remembered and put back.

let original: number | null = null;

export async function setScreenBrightness(level: number): Promise<void> {
  try {
    if (Platform.OS === 'ios' && original === null)
      original = await Brightness.getBrightnessAsync();
    await Brightness.setBrightnessAsync(level);
  } catch {
    // Not available (e.g. a simulator): ignore.
  }
}

export async function restoreScreenBrightness(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Brightness.restoreSystemBrightnessAsync();
    } else if (original !== null) {
      await Brightness.setBrightnessAsync(original);
      original = null;
    }
  } catch {
    // ignore
  }
}
