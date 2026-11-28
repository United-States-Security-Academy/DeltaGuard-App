import Ionicons from '@expo/vector-icons/Ionicons';
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import alarmSound from '@/assets/sounds/welfare_alarm.wav';
import { useNow } from '@/components/clock-panel';
import { restoreScreenBrightness, setScreenBrightness } from '@/lib/brightness';
import { brand, fx } from '@/lib/theme';
import { type DueCheck, useWelfare } from '@/lib/welfare';
import { tryNative } from '@/lib/welfare-native';

/**
 * Full-screen "Confirm you are alert" over everything while a welfare check is
 * due. A countdown runs for the policy's time to answer; then a loud looping
 * alarm (plays on silent, media volume raised on Android) with continuous
 * vibration until the officer confirms with biometrics / passcode. It can't
 * be closed any other way: answering is the only way out.
 */
export function WelfarePrompt() {
  const { due, confirm, shift } = useWelfare();
  if (!due) return null;
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      // Android back button: does nothing (answering is the way out).
      onRequestClose={() => undefined}
    >
      <PromptBody due={due} confirm={confirm} siteName={shift?.site?.name ?? null} />
    </Modal>
  );
}

function PromptBody({
  due,
  confirm,
  siteName,
}: {
  due: DueCheck;
  confirm: () => Promise<string | null>;
  siteName: string | null;
}) {
  const insets = useSafeAreaInsets();
  const now = useNow(1000);
  const alarming = now >= due.alarmAt;
  const secondsLeft = Math.max(0, Math.ceil((due.alarmAt - now) / 1000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useAlarm(alarming);

  useEffect(() => {
    void setScreenBrightness(1);
    return () => {
      void restoreScreenBrightness();
    };
  }, []);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    const message = await confirm();
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <View
      className="flex-1 items-center justify-between px-6"
      style={{
        backgroundColor: alarming ? '#7F1D1D' : brand.ink,
        paddingTop: insets.top + 32,
        paddingBottom: insets.bottom + 32,
      }}
    >
      <View className="items-center gap-3">
        <Text className="text-xs font-bold uppercase tracking-[3px] text-gold">Welfare check</Text>
        <Text className="text-center text-3xl font-extrabold text-white" accessibilityRole="header">
          Confirm you are alert
        </Text>
        {siteName ? <Text className="text-base text-white/70">{siteName}</Text> : null}
      </View>

      <View className="items-center gap-2" accessibilityLiveRegion="polite">
        {alarming ? (
          <>
            <Ionicons name="alarm" size={44} color="#FCA5A5" />
            <Text className="text-center text-xl font-extrabold text-white">
              Answer now: your supervisor will be called
            </Text>
          </>
        ) : (
          <>
            <Text
              className="text-6xl font-extrabold text-white"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </Text>
            <Text className="text-sm text-white/60">left to answer before the alarm</Text>
          </>
        )}
      </View>

      <View className="w-full items-center gap-4">
        <Pressable
          onPress={onConfirm}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="I'm alert. Confirm with fingerprint, face or passcode"
          className="h-56 w-56 items-center justify-center gap-2 rounded-full active:opacity-80"
          style={fx.gold}
        >
          {busy ? (
            <ActivityIndicator color={brand.ink} size="large" />
          ) : (
            <>
              <Ionicons name="finger-print" size={54} color={brand.ink} />
              <Text className="text-2xl font-extrabold" style={{ color: brand.ink }}>
                I’m alert
              </Text>
            </>
          )}
        </Pressable>
        <Text className="text-center text-sm text-white/70">
          Confirm with your fingerprint, face or phone passcode.
        </Text>
        {error ? (
          <Text className="text-center text-sm font-bold text-red-300" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The alarm: looping sound (also on silent), continuous vibration, media volume up (Android). */
function useAlarm(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let player: AudioPlayer | null = null;
    let stopped = false;
    const previousVolume = tryNative((m) => m.maxMediaVolume());
    Vibration.vibrate([0, 1000, 500], true);
    void (async () => {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      }).catch(() => undefined);
      if (stopped) return;
      player = createAudioPlayer(alarmSound);
      player.loop = true;
      player.volume = 1;
      player.play();
    })();
    return () => {
      stopped = true;
      Vibration.cancel();
      player?.pause();
      player?.remove();
      if (previousVolume !== null) tryNative((m) => m.restoreMediaVolume(previousVolume));
    };
  }, [on]);
}
