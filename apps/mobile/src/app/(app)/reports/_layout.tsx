import { Stack } from 'expo-router';

import { NotificationBell } from '@/components/notification-bell';
import { brand } from '@/lib/theme';

// Reports has its own stack (list -> report), like Shifts.
export default function ReportsLayout() {
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
        options={{ title: 'Reports', headerRight: () => <NotificationBell /> }}
      />
      <Stack.Screen
        name="draft/[id]"
        options={{ title: 'Incident report', headerBackTitle: 'Reports' }}
      />
      <Stack.Screen
        name="incident/[id]"
        options={{ title: 'Incident report', headerBackTitle: 'Reports' }}
      />
    </Stack>
  );
}
