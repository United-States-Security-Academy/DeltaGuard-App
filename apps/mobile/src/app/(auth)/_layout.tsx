import { Stack } from 'expo-router';

import { brand } from '@/lib/theme';

// The group opens on the landing page; sign-in is pushed on top of it so the
// back button returns to the landing page.
export const unstable_settings = { anchor: 'welcome' };

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: brand.ink } }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
