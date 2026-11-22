import { APP_NAME } from '@deltaguard/shared';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import logo from '@/assets/images/logo.png';
import { useSession } from '@/lib/session';

import { Body, Button, Notice, Title } from './ui';

/** Covers the whole app until the OS confirms the phone's owner. */
export function LockScreen() {
  const { unlock, signOut } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  // Starts busy: the OS prompt opens as soon as the lock screen appears.
  const [busy, setBusy] = useState(true);

  const finish = useCallback((result: Awaited<ReturnType<typeof unlock>>) => {
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  }, []);

  const tryUnlock = useCallback(() => {
    setBusy(true);
    void unlock().then(finish);
  }, [unlock, finish]);

  useEffect(() => {
    void unlock().then(finish);
  }, [unlock, finish]);

  return (
    <View className="absolute inset-0 bg-ink">
      <SafeAreaView className="flex-1 justify-center gap-6 px-6">
        <Image
          source={logo}
          style={{ width: 96, height: 120, alignSelf: 'center' }}
          contentFit="contain"
          accessibilityLabel="Deltacon Security Group badge"
        />
        <View className="gap-2">
          <Title>{APP_NAME} is locked</Title>
          <Body>Use Face ID, your fingerprint or your phone passcode to continue.</Body>
        </View>
        {message ? <Notice tone="error">{message}</Notice> : null}
        <Button title="Unlock" onPress={tryUnlock} loading={busy} />
        <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
      </SafeAreaView>
    </View>
  );
}
