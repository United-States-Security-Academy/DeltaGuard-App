import { Stack } from 'expo-router';

import { stackScreenOptions, topLevelHeader } from '@/components/header';

// Shifts has its own stack so a shift's detail opens on top of the list,
// inside the tab. The tab hides its own header for this (see (tabs)/_layout).
export default function ShiftsLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Shifts', ...topLevelHeader }} />
      <Stack.Screen name="[id]" options={{ title: 'Shift', headerBackTitle: 'Shifts' }} />
      <Stack.Screen
        name="report/[id]"
        options={{ title: 'Daily activity report', headerBackTitle: 'Back' }}
      />
    </Stack>
  );
}
