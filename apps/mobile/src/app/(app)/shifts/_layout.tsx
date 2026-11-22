import { Stack } from 'expo-router';

import { NotificationBell } from '@/components/notification-bell';
import { brand } from '@/lib/theme';

// Shifts has its own stack so a shift's detail opens on top of the list,
// inside the tab. The tab hides its own header for this (see (app)/_layout).
export default function ShiftsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: brand.ink },
        headerTitleStyle: { color: brand.white, fontWeight: '700' },
        headerTintColor: brand.gold,
        contentStyle: { backgroundColor: brand.ink },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Shifts', headerRight: () => <NotificationBell /> }}
      />
      <Stack.Screen name="[id]" options={{ title: 'Shift', headerBackTitle: 'Shifts' }} />
      <Stack.Screen
        name="report/[id]"
        options={{ title: 'Daily activity report', headerBackTitle: 'Back' }}
      />
    </Stack>
  );
}
