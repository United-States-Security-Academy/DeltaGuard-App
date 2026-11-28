import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as ScreenCapture from 'expo-screen-capture';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LockScreen } from '@/components/lock-screen';
import { Button, Loading, Notice, Title } from '@/components/ui';
import { queryClient } from '@/lib/query-client';
import { SessionProvider, useSession } from '@/lib/session';
import { brand, fx } from '@/lib/theme';

// Keep the splash screen up until we know whether someone is signed in.
void SplashScreen.preventAutoHideAsync();
// iOS: blur DeltaGuard in the app switcher so a glance at the phone doesn't
// show reports or personal data. (Android: modules/welfare-alarm hides it.)
if (Platform.OS === 'ios') {
  void ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => undefined);
}

// Portrait everywhere. app.json allows every orientation only so the
// signature pad (components/signature-pad.tsx) can turn to landscape; iOS
// starts portrait through the expo-screen-orientation plugin.
void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});

// Headers, the tab bar and screen backgrounds use the Deltacon palette. The
// app is always dark (app.json userInterfaceStyle), matching the badge.
const BrandNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: brand.gold,
    background: brand.ink,
    card: brand.navy,
    text: brand.white,
    border: 'rgba(214, 181, 98, 0.18)', // gold, faint
    notification: brand.gold,
  },
};

export default function RootLayout() {
  return (
    // KeyboardProvider: keyboard tracking for components/keyboard.tsx (Android
    // is edge-to-edge, so the window doesn't resize for the keyboard).
    // GestureHandlerRootView: pinch-to-zoom on form pages (components/form-page.tsx).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider value={BrandNavTheme}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <RootNavigator />
              <StatusBar style="light" />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { state, locked, retry, signOut } = useSession();

  useEffect(() => {
    if (state.status !== 'loading') SplashScreen.hide();
  }, [state.status]);

  if (state.status === 'loading') return <Loading />;

  if (state.status === 'unreachable') {
    return (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-ink px-6">
        <Title>Can&apos;t connect</Title>
        <Notice tone="error">{state.message}</Notice>
        <Button title="Try again" onPress={retry} />
        <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
      </SafeAreaView>
    );
  }

  const signedIn = state.status === 'ready';

  // Stack.Protected: a group is only reachable while its guard is true. When
  // the guard flips (sign in / sign out), Expo Router moves to a screen that
  // is allowed and drops the others from history.
  return (
    <View className="flex-1 bg-ink">
      {/* contentStyle paints the page gradient (screens are transparent). */}
      <Stack screenOptions={{ headerShown: false, contentStyle: fx.backdrop }}>
        {/* redirectTo says where to go when a URL hits a blocked group,
            e.g. the app opening at "/" (Home) while signed out. */}
        <Stack.Protected guard={signedIn} redirectTo="/welcome">
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* Opened from the invite deep link; works signed in or out. */}
        <Stack.Screen name="set-password" />
      </Stack>
      {signedIn && locked ? <LockScreen /> : null}
    </View>
  );
}
