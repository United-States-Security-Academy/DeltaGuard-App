import '../global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LockScreen } from '@/components/lock-screen';
import { Button, Loading, Notice, Title } from '@/components/ui';
import { SessionProvider, useSession } from '@/lib/session';

// Keep the splash screen up until we know whether someone is signed in.
void SplashScreen.preventAutoHideAsync();

// Headers and the tab bar follow the phone's light/dark setting, matching the
// NativeWind screens (bg-white / dark:bg-slate-950).
const LightNavTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#ffffff', card: '#ffffff' },
};
const DarkNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#020617', // slate-950
    card: '#0f172a', // slate-900
    border: '#1e293b', // slate-800
  },
};

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkNavTheme : LightNavTheme}>
      <SessionProvider>
        <RootNavigator />
        <StatusBar style="auto" />
      </SessionProvider>
    </ThemeProvider>
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
      <SafeAreaView className="flex-1 justify-center gap-4 bg-white px-6 dark:bg-slate-950">
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
    <View className="flex-1">
      <Stack screenOptions={{ headerShown: false }}>
        {/* redirectTo says where to go when a URL hits a blocked group,
            e.g. the app opening at "/" (Home) while signed out. */}
        <Stack.Protected guard={signedIn} redirectTo="/sign-in">
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
