import { Stack } from 'expo-router';

import { stackScreenOptions, topLevelHeader } from '@/components/header';

// Reports has its own stack (list -> report), like Shifts.
export default function ReportsLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Reports', ...topLevelHeader }} />
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
