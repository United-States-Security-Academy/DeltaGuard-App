import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import {
  AndroidAudioContentType,
  AndroidAudioUsage,
  AndroidImportance,
  AndroidNotificationPriority,
  AndroidNotificationVisibility,
  SchedulableTriggerInputTypes,
} from 'expo-notifications';
import { Platform } from 'react-native';

import { tryNative, welfareNative } from './welfare-native';

// Welfare check alerts scheduled ON THE PHONE, so a check is announced at its
// time even without internet (the server's pushes may arrive too; the app
// hides both while it is open, because the prompt is on screen).
//
//   at the check's time   prompt: Android = full-screen alarm notification
//                          (modules/welfare-alarm), else a time-sensitive
//                          notification
//   + response_seconds     alarm notification, repeated every 30 s for 5 min
//                          (a notification sound can't loop; the app's own
//                          alarm loops when it is open)

export const WELFARE_LOCAL_TYPE = 'welfare_local';
export const WELFARE_RETURN_TYPE = 'welfare_return';
export const WELFARE_BATTERY_TYPE = 'welfare_battery';
/** Alerts the open app replaces with its own prompt (no banner, no sound). */
export const WELFARE_PROMPT_TYPES = new Set([WELFARE_LOCAL_TYPE, 'welfare_check', 'welfare_alarm']);

const PROMPT_CHANNEL = 'welfare_prompt';
const ALARM_CHANNEL = 'welfare_alarm';
const DUTY_CHANNEL = 'welfare_duty';
const ALARM_SOUND = 'welfare_alarm.wav';
const ALARM_REPEATS = 10;
const ALARM_EVERY_MS = 30_000;
const PREFIX = 'welfare-check-';
const RETURN_ID = 'welfare-return';

/** Built with IOS_CRITICAL_ALERTS=1 (see app.config.ts): only after Apple grants the entitlement. */
export const criticalAlertsEnabled =
  Platform.OS === 'ios' &&
  (Constants.expoConfig?.extra as { criticalAlerts?: boolean } | undefined)?.criticalAlerts ===
    true;

const PROMPT = {
  title: 'Welfare check',
  body: 'Open DeltaGuard and confirm you are alert.',
};
const ALARM = {
  title: 'Welfare check: answer now',
  body: 'You missed a welfare check. Open DeltaGuard and confirm you are alert, or your supervisor will be called.',
};

/** Android notification channels (their sound and importance can't change once made). */
export async function ensureWelfareChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PROMPT_CHANNEL, {
    name: 'Welfare check prompts',
    description: 'Asks you to confirm you are alert while on duty.',
    importance: AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 600, 300, 600],
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    audioAttributes: {
      usage: AndroidAudioUsage.ALARM,
      contentType: AndroidAudioContentType.SONIFICATION,
    },
  });
  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL, {
    name: 'Welfare check alarm',
    description: 'Loud alarm when a welfare check has not been answered.',
    importance: AndroidImportance.MAX,
    sound: ALARM_SOUND,
    vibrationPattern: [0, 1000, 400, 1000, 400, 1000],
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    // The alarm stream: plays when the ringer is on silent or vibrate, at the alarm volume.
    audioAttributes: {
      usage: AndroidAudioUsage.ALARM,
      contentType: AndroidAudioContentType.SONIFICATION,
    },
  });
  await Notifications.setNotificationChannelAsync(DUTY_CHANNEL, {
    name: 'On-duty reminders',
    description: 'Return to on-duty mode, battery and charger warnings.',
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
}

const iosLevel = criticalAlertsEnabled ? ('critical' as const) : ('timeSensitive' as const);

/** Removes every scheduled and shown welfare alert from the phone. */
export async function cancelWelfareAlerts(nativeIds: readonly string[]): Promise<void> {
  for (const id of nativeIds) tryNative((m) => m.cancel(id));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(PREFIX))
      .map((n) =>
        Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined),
      ),
  );
  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  await Promise.all(
    shown
      .filter((n) => {
        const type = (n.request.content.data as Record<string, unknown> | null)?.type;
        return (
          n.request.identifier.startsWith(PREFIX) ||
          (typeof type === 'string' && WELFARE_PROMPT_TYPES.has(type))
        );
      })
      .map((n) =>
        Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined),
      ),
  );
}

/**
 * Schedules the prompt and the alarm for one check. Returns the ids of alarms
 * scheduled through the Android module (to cancel later).
 */
export async function scheduleWelfareAlerts(
  check: { id: string; scheduledAt: string },
  responseSeconds: number,
): Promise<string[]> {
  const at = Date.parse(check.scheduledAt);
  const now = Date.now();
  const data = { type: WELFARE_LOCAL_TYPE, check_id: check.id };
  const nativeIds: string[] = [];

  if (at > now) {
    const nativeId = `check-${check.id}`;
    const viaModule = tryNative((m) => {
      m.schedule(nativeId, at, PROMPT.title, PROMPT.body);
      return true;
    });
    if (viaModule) {
      nativeIds.push(nativeId);
    } else {
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${check.id}-prompt`,
        content: {
          ...PROMPT,
          data,
          sound: criticalAlertsEnabled ? 'defaultCritical' : 'default',
          interruptionLevel: iosLevel,
          priority: AndroidNotificationPriority.MAX,
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: PROMPT_CHANNEL,
          delivery: 'alarmClock',
        },
      });
    }
  }

  for (let k = 0; k < ALARM_REPEATS; k++) {
    const when = at + responseSeconds * 1000 + k * ALARM_EVERY_MS;
    if (when <= now) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}${check.id}-alarm-${k}`,
      content: {
        ...ALARM,
        data,
        // iOS: the alarm file, or the system critical sound (custom sounds
        // can't be critical through expo-notifications). Android: the channel's.
        sound: criticalAlertsEnabled ? 'defaultCritical' : ALARM_SOUND,
        interruptionLevel: iosLevel,
        priority: AndroidNotificationPriority.MAX,
        vibrate: [0, 1000, 400, 1000],
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: ALARM_CHANNEL,
        delivery: 'alarmClock',
      },
    });
  }
  return nativeIds;
}

/** "Return to on-duty mode", shown a little after the officer leaves the app. */
export async function scheduleReturnReminder(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: RETURN_ID,
    content: {
      title: 'You are on duty',
      body: 'Go back to DeltaGuard and leave it open, so welfare checks reach you straight away.',
      data: { type: WELFARE_RETURN_TYPE },
      interruptionLevel: 'timeSensitive',
    },
    trigger: {
      type: SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 20,
      channelId: DUTY_CHANNEL,
    },
  }).catch(() => undefined);
}

export async function clearReturnReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(RETURN_ID).catch(() => undefined);
  await Notifications.dismissNotificationAsync(RETURN_ID).catch(() => undefined);
}

/** A battery / charger warning, now. */
export async function notifyDuty(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { type: WELFARE_BATTERY_TYPE },
      interruptionLevel: 'timeSensitive',
    },
    trigger: Platform.OS === 'android' ? { channelId: DUTY_CHANNEL } : null,
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// What the phone allows (shown on the duty screen with a way to fix it)
// ---------------------------------------------------------------------------

export type AlertSetup = {
  notifications: boolean;
  /** iOS with the Critical Alerts build flag only. */
  criticalAlerts: boolean | null;
  /** Android with the welfare module only. */
  exactAlarms: boolean | null;
  fullScreen: boolean | null;
};

export async function readAlertSetup(): Promise<AlertSetup> {
  const permission = await Notifications.getPermissionsAsync();
  return {
    notifications: permission.status === 'granted',
    criticalAlerts: criticalAlertsEnabled ? permission.ios?.allowsCriticalAlerts === true : null,
    exactAlarms: welfareNative ? tryNative((m) => m.canScheduleExactAlarms()) : null,
    fullScreen: welfareNative ? tryNative((m) => m.canUseFullScreenIntent()) : null,
  };
}

/** Notification permission (and Critical Alerts when built with the flag). */
export async function requestAlertPermission(): Promise<void> {
  await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
      allowBadge: true,
      allowCriticalAlerts: criticalAlertsEnabled,
    },
  });
}
