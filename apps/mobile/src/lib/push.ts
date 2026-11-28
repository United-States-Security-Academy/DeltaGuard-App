import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { MESSAGE_NOTIFICATION_TYPE } from '@deltaguard/shared';

import { getOrCreateDeviceId } from './device';
import { getOpenConversation } from './messaging';
import { brand } from './theme';
import { WELFARE_PROMPT_TYPES } from './welfare-alerts';
import { supabase } from './supabase';

// Expo push notifications.
//
// After sign-in (session.tsx) the phone asks for permission, gets its Expo
// push token and saves it on the user's active row in user_devices; the
// server (send-notification Edge Function) sends to that token. On sign-out
// the token is removed first. When an admin resets the device, the database
// clears the token itself (the phone may not be online to do it).
//
// Push needs a development or store build: Expo Go can't receive them.

// Show alerts that arrive while the app is open, like ones that arrive in the
// background, except a chat message for the conversation already on screen
// (it appears in the chat itself) and welfare prompts (the app shows its own).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
    const onScreen =
      (data.type === MESSAGE_NOTIFICATION_TYPE &&
        typeof data.conversation_id === 'string' &&
        data.conversation_id === getOpenConversation()) ||
      // Welfare prompts: the open app shows its own full-screen prompt and alarm.
      (typeof data.type === 'string' &&
        WELFARE_PROMPT_TYPES.has(data.type) &&
        AppState.currentState === 'active');
    return {
      shouldShowBanner: !onScreen,
      shouldShowList: !onScreen,
      shouldPlaySound: !onScreen,
      shouldSetBadge: true,
    };
  },
});

/** The EAS project id (written to app.json by `eas init`). */
function projectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? null;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  // Must exist before asking for the token on Android 13+; the server sends
  // with channelId 'default'.
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Alerts',
    importance: AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: brand.gold,
  });
  // SOS alerts: highest importance (heads-up, sound) on their own channel, so
  // they can't be confused with routine alerts. The server sends type 'sos'
  // with channelId 'sos'.
  await Notifications.setNotificationChannelAsync('sos', {
    name: 'SOS alerts',
    importance: AndroidImportance.MAX,
    vibrationPattern: [0, 500, 200, 500, 200, 500],
    lightColor: '#DC2626',
    bypassDnd: true,
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
  });
}

export type PushRegistration =
  | { ok: true; token: string }
  | { ok: false; reason: 'not_device' | 'denied' | 'no_project' | 'error'; message?: string };

async function saveToken(userId: string, token: string | null): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  // RLS: only the user's own, non-revoked device row.
  const { error } = await supabase
    .from('user_devices')
    .update({ push_token: token })
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .is('revoked_at', null);
  if (error) throw new Error(error.message);
}

/**
 * Gets this phone's Expo push token and stores it. `ask`: show the permission
 * prompt if needed (right after signing in); otherwise only refresh the token
 * when permission was already given (every app start). Safe to repeat.
 */
export async function registerForPush(
  userId: string,
  { ask }: { ask: boolean },
): Promise<PushRegistration> {
  if (!Device.isDevice) return { ok: false, reason: 'not_device' };
  const id = projectId();
  if (!id) return { ok: false, reason: 'no_project' };
  try {
    await ensureAndroidChannel();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask) {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') {
      // Don't keep an old token for a phone that no longer allows alerts.
      await saveToken(userId, null).catch(() => undefined);
      return { ok: false, reason: 'denied' };
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await saveToken(userId, token);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error).message };
  }
}

/** Before signing out: stop pushes to this phone. Best effort, never blocks for long. */
export async function unregisterPush(userId: string): Promise<void> {
  await Promise.race([
    saveToken(userId, null).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

/** Expo can rotate the token; keep the stored one current. */
export function watchPushToken(userId: string): () => void {
  const sub = Notifications.addPushTokenListener(() => {
    void registerForPush(userId, { ask: false });
  });
  return () => sub.remove();
}
