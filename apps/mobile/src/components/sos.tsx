import { EMERGENCY_NUMBER, SOS_HOLD_MS } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSos } from '@/lib/sos';
import { brand } from '@/lib/theme';

const RED = '#DC2626';

/** An open conversation: /messages/<id> (not the list or "new message"). */
function isChatThread(pathname: string): boolean {
  const match = /^\/messages\/([^/]+)$/.exec(pathname);
  return match !== null && match[1] !== 'new';
}

/**
 * Floating SOS button on every signed-in screen. Press and hold for 2 seconds
 * (the fill shows progress; letting go early cancels), then a 5 second
 * countdown can still be cancelled. While an alert is open, one tap shows it.
 * Hidden in an open chat, where it would sit on top of the send button (the
 * Home tab is one tap away); shown again there while an alert is open.
 */
export function SosButton() {
  const { startCountdown, alert, sending, openScreen, countdown } = useSos();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(1));
  const [holding, setHolding] = useState(false);
  const active = sending || alert?.status === 'active' || alert?.status === 'acknowledged';
  const pathname = usePathname();

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  function pressIn() {
    if (active) return;
    setHolding(true);
    Vibration.vibrate(30);
    Animated.timing(progress, {
      toValue: 1,
      duration: SOS_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      setHolding(false);
      progress.setValue(0);
      if (finished) startCountdown();
    });
  }

  function pressOut() {
    if (active) return;
    progress.stopAnimation();
    progress.setValue(0);
    setHolding(false);
  }

  if (countdown !== null) return null;
  if (!active && isChatThread(pathname)) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', right: 16, bottom: insets.bottom + 64 }}
      className="items-center"
    >
      {holding ? (
        <View className="mb-2 rounded-full bg-black/80 px-3 py-1">
          <Text className="text-xs font-semibold text-white">Keep holding…</Text>
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Pressable
          onPressIn={pressIn}
          onPressOut={pressOut}
          onPress={active ? openScreen : undefined}
          accessibilityRole="button"
          accessibilityLabel={active ? 'SOS active, open the alert' : 'SOS emergency alert'}
          accessibilityHint={
            active ? undefined : 'Press and hold for 2 seconds to send an emergency alert'
          }
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: RED,
            borderWidth: 3,
            borderColor: active ? '#FFFFFF' : brand.gold,
            overflow: 'hidden',
            elevation: 8,
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
          }}
          className="items-center justify-center"
        >
          {/* Fills up while holding. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: 'rgba(255,255,255,0.45)',
              transform: [{ scale: progress }],
            }}
          />
          <Text className="text-lg font-black tracking-wider text-white">SOS</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Full-screen 5 second countdown with a big Cancel button. */
export function SosCountdown() {
  const { countdown, cancelCountdown } = useSos();
  return (
    <Modal visible={countdown !== null} animationType="fade" onRequestClose={cancelCountdown}>
      <View
        style={{ backgroundColor: RED }}
        className="flex-1 items-center justify-center gap-8 p-8"
      >
        <Text className="text-center text-2xl font-bold text-white">Sending SOS in</Text>
        <Text
          accessibilityLiveRegion="assertive"
          className="text-[120px] font-black leading-[130px] text-white"
        >
          {countdown ?? ''}
        </Text>
        <Text className="text-center text-base text-white/90">
          Your supervisors will be alerted with your location.
        </Text>
        <Pressable
          onPress={cancelCountdown}
          accessibilityRole="button"
          accessibilityLabel="Cancel SOS"
          className="w-full items-center rounded-3xl bg-white py-6 active:opacity-80"
        >
          <Text className="text-2xl font-black" style={{ color: RED }}>
            CANCEL
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function BigButton({
  label,
  sublabel,
  icon,
  onPress,
  tone,
}: {
  label: string;
  sublabel?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  tone: 'red' | 'white' | 'navy';
}) {
  const styles = {
    red: { bg: RED, fg: '#FFFFFF' },
    white: { bg: '#FFFFFF', fg: brand.ink },
    navy: { bg: brand.navy, fg: '#FFFFFF' },
  }[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      style={{ backgroundColor: styles.bg }}
      className="min-h-20 flex-row items-center gap-4 rounded-3xl px-6 py-4 active:opacity-80"
    >
      <Ionicons name={icon} size={30} color={styles.fg} />
      <View className="flex-1">
        <Text style={{ color: styles.fg }} className="text-xl font-extrabold">
          {label}
        </Text>
        {sublabel ? (
          <Text style={{ color: styles.fg }} className="text-sm opacity-80">
            {sublabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The officer's SOS screen: status, location, and the calls that matter. */
export function SosScreen() {
  const sos = useSos();
  const insets = useSafeAreaInsets();
  const { alert, sending, offline, location, lastFix, contacts } = sos;
  const closed = alert?.status === 'resolved' || alert?.status === 'false_alarm';
  const supervisor = contacts[0];

  const [title, detail] = closed
    ? [
        alert?.status === 'false_alarm' ? 'SOS closed: false alarm' : 'SOS resolved',
        [alert?.resolved_by_name, alert?.resolution_notes].filter(Boolean).join(': '),
      ]
    : alert?.status === 'acknowledged'
      ? [
          'Help is on the way',
          `${alert.acknowledged_by_name ?? 'A supervisor'} has your alert${
            alert.acknowledge_notes ? `: ${alert.acknowledge_notes}` : '.'
          }`,
        ]
      : alert
        ? [
            'Help is being notified',
            'Supervisors and admins are being alerted by push notification and text message.',
          ]
        : offline
          ? ['No connection', 'Still trying to send your SOS. Call or text your supervisor now.']
          : ['Sending SOS…', 'Alerting your supervisors.'];

  function imSafe() {
    Alert.alert('Close the SOS?', 'Your supervisors will be told.', [
      { text: 'I’m safe now', onPress: () => void sos.markSafe(false) },
      { text: 'It was a false alarm', onPress: () => void sos.markSafe(true) },
      { text: 'Keep it open', style: 'cancel' },
    ]);
  }

  const locationText =
    location === 'denied'
      ? 'Location is off for DeltaGuard. Tell them where you are.'
      : location === 'unavailable' && !lastFix
        ? 'Couldn’t get your location. Tell them where you are.'
        : lastFix
          ? `Location ${alert ? 'shared' : 'found'}${
              lastFix.accuracyM ? ` (within ${Math.round(lastFix.accuracyM)} m)` : ''
            } · ${new Date(lastFix.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
              alert && !closed ? ' · updates every 30 s while the app is open' : ''
            }`
          : 'Getting your location…';

  return (
    <Modal
      visible={sos.screenOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={sos.dismiss}
    >
      <View
        style={{ paddingTop: insets.top + 12, backgroundColor: closed ? brand.ink : '#450A0A' }}
        className="flex-1"
      >
        <ScrollView contentContainerClassName="gap-5 px-6 pb-10">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              {!closed ? <View className="h-3 w-3 rounded-full bg-red-500" /> : null}
              <Text className="text-sm font-bold uppercase tracking-[3px] text-white/80">
                {closed ? 'SOS' : 'SOS active'}
              </Text>
            </View>
            <Pressable onPress={sos.dismiss} hitSlop={12} accessibilityRole="button">
              <Text className="text-base font-semibold text-white/80">
                {closed ? 'Done' : 'Hide'}
              </Text>
            </Pressable>
          </View>

          <View className="gap-2">
            <View className="flex-row items-center gap-3">
              {sending && !alert ? <ActivityIndicator color="#FFFFFF" /> : null}
              <Text accessibilityRole="header" className="flex-1 text-4xl font-black text-white">
                {title}
              </Text>
            </View>
            {detail ? <Text className="text-lg leading-7 text-white/90">{detail}</Text> : null}
            {alert?.site_name && !closed ? (
              <Text className="text-base text-white/70">Site: {alert.site_name}</Text>
            ) : null}
          </View>

          <View className="flex-row items-start gap-2 rounded-2xl bg-black/30 p-4">
            <Ionicons
              name={lastFix ? 'location' : 'location-outline'}
              size={20}
              color={location === 'denied' ? '#FCA5A5' : brand.gold}
            />
            <Text className="flex-1 text-sm leading-5 text-white/90">{locationText}</Text>
          </View>

          {!closed ? (
            <View className="gap-3">
              <BigButton
                tone="white"
                icon="call"
                label={`Call ${EMERGENCY_NUMBER}`}
                sublabel="Emergency services"
                onPress={() => sos.call(EMERGENCY_NUMBER, 'emergency')}
              />
              {supervisor ? (
                <BigButton
                  tone="red"
                  icon="person"
                  label="Call supervisor"
                  sublabel={supervisor.name}
                  onPress={() => sos.call(supervisor.phone, 'supervisor')}
                />
              ) : null}
              {offline || (sending && !alert) ? (
                <BigButton
                  tone="navy"
                  icon="chatbubble-ellipses"
                  label="Text supervisor"
                  sublabel="Opens your messages app with your location"
                  onPress={sos.textSupervisor}
                />
              ) : null}
              {contacts.length > 1 ? (
                <View className="gap-1 pt-2">
                  <Text className="text-xs font-semibold uppercase tracking-widest text-white/60">
                    Other contacts
                  </Text>
                  {contacts.slice(1, 4).map((c) => (
                    <Pressable
                      key={c.phone}
                      onPress={() => sos.call(c.phone, 'supervisor')}
                      className="flex-row items-center justify-between rounded-2xl bg-black/25 px-4 py-3 active:opacity-70"
                    >
                      <Text className="text-base text-white">{c.name}</Text>
                      <Ionicons name="call-outline" size={20} color={brand.gold} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Pressable
                onPress={imSafe}
                className="mt-4 items-center py-3"
                accessibilityRole="button"
              >
                <Text className="text-base font-semibold text-white/70 underline">
                  I’m safe / close the SOS
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={sos.dismiss}
              className="items-center rounded-3xl bg-gold py-5 active:opacity-80"
              accessibilityRole="button"
            >
              <Text className="text-lg font-bold text-ink">Done</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
