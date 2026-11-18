import * as LocalAuthentication from 'expo-local-authentication';

export type UnlockResult = { ok: true } | { ok: false; message: string };

/**
 * Asks the OS to confirm it's the phone's owner: Face ID / Touch ID /
 * fingerprint, falling back to the phone's PIN, pattern or passcode. The app
 * never sees the biometric data, only a yes/no from the OS.
 */
export async function authenticateOwner(): Promise<UnlockResult> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    return {
      ok: false,
      message:
        'This phone has no screen lock. Set up a PIN, pattern, fingerprint or face unlock in your phone settings to use DeltaGuard.',
    };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock DeltaGuard',
    cancelLabel: 'Cancel',
    // false = allow the phone's passcode/PIN when biometrics fail or aren't set up.
    disableDeviceFallback: false,
  });
  if (result.success) return { ok: true };

  switch (result.error) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      return { ok: false, message: 'Unlock cancelled.' };
    case 'lockout':
      return { ok: false, message: 'Too many attempts. Unlock your phone, then try again.' };
    default:
      return { ok: false, message: "Couldn't confirm it's you. Try again." };
  }
}
