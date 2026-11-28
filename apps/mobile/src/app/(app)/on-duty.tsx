import {
  formatDate,
  toZoned,
  WELFARE_CHECK_STATUS_LABELS,
  WELFARE_RESPONSE_FLAG_LABELS,
  type WelfareCheckStatus,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNow } from '@/components/clock-panel';
import { Badge, Button } from '@/components/ui';
import { restoreScreenBrightness, setScreenBrightness } from '@/lib/brightness';
import { useCompanySettings } from '@/lib/shifts';
import { brand } from '@/lib/theme';
import { type BatteryInfo, useWelfare, useWelfareHistory } from '@/lib/welfare';
import {
  type AlertSetup,
  criticalAlertsEnabled,
  readAlertSetup,
  requestAlertPermission,
} from '@/lib/welfare-alerts';
import { welfareNative } from '@/lib/welfare-native';

/** Screen brightness while dimmed (0..1). */
const DIM = 0.08;
/** A tap brightens the screen this long. */
const AWAKE_MS = 20_000;

/**
 * The on-duty screen: black, dimmed and quiet to save battery, showing the
 * time, site and shift end, battery and welfare check status, and this
 * shift's check history. Tap to brighten for a moment. The floating SOS
 * button stays on top (layout). Leaving it keeps on-duty mode running.
 */
export default function OnDutyScreen() {
  const insets = useSafeAreaInsets();
  const welfare = useWelfare();
  const { timeZone } = useCompanySettings();
  const now = useNow(1000);
  const [awake, setAwake] = useState(false);
  const missing = setupProblems(welfare.setup);
  const bright = awake || welfare.due !== null || missing.length > 0;

  useEffect(() => {
    if (!awake) return;
    const timer = setTimeout(() => setAwake(false), AWAKE_MS);
    return () => clearTimeout(timer);
  }, [awake]);

  useFocusEffect(
    useCallback(() => {
      void (bright ? restoreScreenBrightness() : setScreenBrightness(DIM));
      return () => {
        void restoreScreenBrightness();
      };
    }, [bright]),
  );

  const shift = welfare.shift;
  const clock = toZoned(new Date(now), timeZone);
  const dim = bright ? '' : 'opacity-60';

  return (
    <Pressable
      className="flex-1"
      style={{ backgroundColor: '#000' }}
      onPress={() => setAwake(true)}
      accessible={false}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName={`gap-6 px-6 ${dim}`}
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 120 }}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-bold uppercase tracking-[3px] text-gold">
            {welfare.onDuty ? 'On duty' : 'Off duty'}
          </Text>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            className="flex-row items-center gap-1 rounded-full border border-white/20 px-4 py-2 active:opacity-70"
          >
            <Ionicons name="apps-outline" size={16} color="white" />
            <Text className="text-sm font-bold text-white">Use the app</Text>
          </Pressable>
        </View>

        <View className="items-center gap-1 py-4">
          <Text
            className="text-7xl font-extralight text-white"
            style={{ fontVariant: ['tabular-nums'] }}
            accessibilityLabel={`Time ${clock.time}`}
          >
            {clock.time}
          </Text>
          <Text className="text-sm text-white/50">{formatDate(clock.date)}</Text>
        </View>

        {shift ? (
          <View className="gap-1">
            <Text className="text-2xl font-bold text-white">{shift.site?.name ?? 'Your site'}</Text>
            <Text className="text-sm text-white/60">
              Shift ends {toZoned(shift.endsAt, timeZone).time}
            </Text>
          </View>
        ) : (
          <Text className="text-base text-white/70">
            You are not clocked in. On-duty mode starts when you clock in.
          </Text>
        )}

        <StatusRow
          icon="pulse"
          text={
            !welfare.onDuty
              ? 'Welfare checks run while you are clocked in.'
              : welfare.hasNextCheck
                ? 'Welfare checks are on. Keep DeltaGuard open: a check can come at any time.'
                : 'No welfare check is scheduled for this shift right now.'
          }
        />
        {welfare.queued.length > 0 ? (
          <StatusRow
            icon="cloud-offline-outline"
            text={`${welfare.queued.length === 1 ? 'Your answer is' : `${welfare.queued.length} answers are`} saved on this phone and will be sent when you have signal.`}
          />
        ) : null}
        <BatteryRow battery={welfare.battery} onDismiss={welfare.dismissUnplugged} />
        <StatusRow
          icon="alert-circle-outline"
          text="Emergency? Hold the SOS button for 2 seconds."
        />

        {missing.length > 0 ? (
          <SetupCard problems={missing} onChanged={welfare.refreshSetup} />
        ) : null}

        <History
          shiftId={shift?.id ?? null}
          timeZone={timeZone}
          queued={welfare.queued.map((q) => q.checkId)}
        />

        {!bright ? (
          <Text className="text-center text-xs text-white/40">
            Screen dimmed to save battery. Tap to brighten.
          </Text>
        ) : null}
      </ScrollView>
    </Pressable>
  );
}

function StatusRow({
  icon,
  text,
}: {
  icon: 'pulse' | 'cloud-offline-outline' | 'alert-circle-outline';
  text: string;
}) {
  return (
    <View className="flex-row items-start gap-3">
      <Ionicons name={icon} size={20} color={brand.gold} />
      <Text className="flex-1 text-sm leading-5 text-white/80">{text}</Text>
    </View>
  );
}

function BatteryRow({ battery, onDismiss }: { battery: BatteryInfo; onDismiss: () => void }) {
  if (battery.level === null) return null;
  const pct = Math.round(battery.level * 100);
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <Ionicons
          name={
            battery.charging ? 'battery-charging' : battery.low ? 'battery-dead' : 'battery-half'
          }
          size={20}
          color={battery.low ? '#F87171' : brand.gold}
        />
        <Text className="text-sm text-white/80">
          Battery {pct}%{battery.charging ? ' · charging' : ''}
        </Text>
      </View>
      {battery.low && !battery.charging ? (
        <Warning
          text={`Battery low (${pct}%). Charge your phone so welfare checks and SOS keep working.`}
        />
      ) : null}
      {battery.unplugged && !battery.charging ? (
        <Warning
          text="The charger was unplugged. Plug it back in if you can."
          onDismiss={onDismiss}
        />
      ) : null}
    </View>
  );
}

function Warning({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  return (
    <View
      className="flex-row items-center gap-3 rounded-2xl border border-red-400/60 bg-red-500/15 p-4"
      accessibilityRole="alert"
    >
      <Ionicons name="warning" size={20} color="#FCA5A5" />
      <Text className="flex-1 text-sm font-bold text-red-100">{text}</Text>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
        >
          <Ionicons name="close" size={18} color="#FCA5A5" />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Permissions the alerts need, in plain language
// ---------------------------------------------------------------------------

type Problem = {
  key: string;
  title: string;
  why: string;
  action: string;
  fix: () => void | Promise<void>;
};

function setupProblems(setup: AlertSetup | null): Problem[] {
  if (!setup) return [];
  const problems: Problem[] = [];
  if (!setup.notifications) {
    problems.push({
      key: 'notifications',
      title: 'Allow notifications',
      why: 'Welfare checks and their alarm reach you as notifications when DeltaGuard is in the background or the phone is locked. Without them, a check can be missed and your supervisor called.',
      action: 'Allow',
      fix: async () => {
        await requestAlertPermission();
        // Refused before: the phone no longer asks, it can only be turned on in Settings.
        if (!(await readAlertSetup()).notifications) await Linking.openSettings();
      },
    });
  }
  if (setup.criticalAlerts === false) {
    problems.push({
      key: 'critical',
      title: 'Allow critical alerts',
      why: 'Lets the welfare alarm sound even when your iPhone is on silent or in a Focus mode.',
      action: 'Allow',
      fix: requestAlertPermission,
    });
  }
  if (setup.exactAlarms === false) {
    problems.push({
      key: 'exact',
      title: 'Allow alarms on time',
      why: 'Lets the welfare check sound at the exact moment, even when the phone is asleep. In the next screen, turn on "Allow setting alarms and reminders" for DeltaGuard.',
      action: 'Open settings',
      fix: () => welfareNative?.openExactAlarmSettings(),
    });
  }
  if (setup.fullScreen === false) {
    problems.push({
      key: 'fullscreen',
      title: 'Allow full-screen alerts',
      why: 'Lets the welfare check open over the lock screen, like an incoming call. In the next screen, turn on full-screen notifications for DeltaGuard.',
      action: 'Open settings',
      fix: () => welfareNative?.openFullScreenIntentSettings(),
    });
  }
  return problems;
}

function SetupCard({ problems, onChanged }: { problems: Problem[]; onChanged: () => void }) {
  return (
    <View
      className="gap-4 rounded-[28px] border border-gold/60 p-5"
      style={{ backgroundColor: brand.navy }}
    >
      <Text className="text-base font-bold text-white">Set up your phone for welfare checks</Text>
      {problems.map((p) => (
        <View key={p.key} className="gap-2">
          <Text className="text-sm font-bold text-gold">{p.title}</Text>
          <Text className="text-sm leading-5 text-white/75">{p.why}</Text>
          <Button
            title={p.action}
            variant="secondary"
            onPress={() => void Promise.resolve(p.fix()).finally(onChanged)}
          />
        </View>
      ))}
      {Platform.OS === 'android' ? (
        <Text className="text-xs leading-4 text-white/55">
          Tip: in your phone’s Do Not Disturb settings, allow alarms, so the welfare alarm can
          sound.
        </Text>
      ) : criticalAlertsEnabled ? null : (
        <Text className="text-xs leading-4 text-white/55">
          Tip: if you use a Focus mode, keep Time Sensitive notifications allowed for DeltaGuard.
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// This shift's checks
// ---------------------------------------------------------------------------

function History({
  shiftId,
  timeZone,
  queued,
}: {
  shiftId: string | null;
  timeZone: string;
  queued: string[];
}) {
  const history = useWelfareHistory(shiftId);
  const items = history.data ?? [];
  if (!shiftId || items.length === 0) return null;
  return (
    <View className="gap-3">
      <Text className="text-xs font-bold uppercase tracking-[2px] text-white/50">
        Welfare checks this shift
      </Text>
      {items.map((item) => {
        const status = item.status as WelfareCheckStatus;
        const waiting = queued.includes(item.id) && item.respondedAt === null;
        const good = status === 'responded' || (status === 'resolved' && item.respondedAt !== null);
        return (
          <View key={item.id} className="flex-row items-center gap-3 border-b border-white/10 pb-3">
            <Text
              className="w-14 text-sm font-bold text-white"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {toZoned(item.scheduledAt, timeZone).time}
            </Text>
            <View className="flex-1 gap-1">
              <Text className="text-sm text-white/80">
                {waiting
                  ? 'Answered · sending when online'
                  : (WELFARE_CHECK_STATUS_LABELS[status] ?? status)}
                {item.responseSeconds !== null ? ` in ${item.responseSeconds} s` : ''}
              </Text>
              {item.flags.length > 0 ? (
                <View className="flex-row flex-wrap gap-1">
                  {item.flags.map((f) => (
                    <Badge key={f} tone={f === 'late' ? 'danger' : 'muted'}>
                      {WELFARE_RESPONSE_FLAG_LABELS[
                        f as keyof typeof WELFARE_RESPONSE_FLAG_LABELS
                      ] ?? f}
                    </Badge>
                  ))}
                </View>
              ) : null}
            </View>
            <Ionicons
              name={
                good || waiting
                  ? 'checkmark-circle'
                  : status === 'cancelled'
                    ? 'remove-circle-outline'
                    : 'alert-circle'
              }
              size={20}
              color={
                good || waiting
                  ? brand.gold
                  : status === 'cancelled'
                    ? 'rgba(255,255,255,0.4)'
                    : '#F87171'
              }
            />
          </View>
        );
      })}
    </View>
  );
}
