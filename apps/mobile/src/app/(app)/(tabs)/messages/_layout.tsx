import { Stack } from 'expo-router';

import { stackScreenOptions, topLevelHeader } from '@/components/header';

// Messages has its own stack (list -> chat), like Shifts and Reports.
export default function MessagesLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Messages', ...topLevelHeader }} />
      <Stack.Screen name="new" options={{ title: 'New message', headerBackTitle: 'Messages' }} />
      <Stack.Screen name="[id]" options={{ title: '', headerBackTitle: 'Messages' }} />
    </Stack>
  );
}
