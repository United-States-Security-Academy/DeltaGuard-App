import { Stack } from 'expo-router';

import { NotificationBell } from '@/components/notification-bell';
import { brand } from '@/lib/theme';

// Messages has its own stack (list -> chat), like Shifts and Reports.
export default function MessagesLayout() {
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
        options={{ title: 'Messages', headerRight: () => <NotificationBell /> }}
      />
      <Stack.Screen name="new" options={{ title: 'New message', headerBackTitle: 'Messages' }} />
      <Stack.Screen name="[id]" options={{ title: '', headerBackTitle: 'Messages' }} />
    </Stack>
  );
}
