import { Stack } from 'expo-router';
import { View } from 'react-native';

import { stackScreenOptions } from '@/components/header';
import { SosButton, SosCountdown, SosScreen } from '@/components/sos';
import { WelfarePrompt } from '@/components/welfare-prompt';
import { ClockProvider } from '@/lib/clock';
import { FormSyncProvider } from '@/lib/form-sync';
import { useDeviceIntegrity } from '@/lib/integrity';
import { IncidentSyncProvider } from '@/lib/incident-sync';
import { useNotificationsBridge } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { TrainingSyncProvider } from '@/lib/training-sync';
import { SosProvider } from '@/lib/sos';
import { WelfareProvider } from '@/lib/welfare';

// Signed-in app: the tab bar ((tabs)/_layout) is the base of this stack, and
// screens opened from the bell or a push (the inbox, an SOS alert) are pushed
// on top of it with a back button.
export default function AppLayout() {
  const { state } = useSession();
  // The root layout only renders this group when signed in.
  if (state.status !== 'ready') return null;
  return <SignedInApp userId={state.profile.id} fullName={state.profile.fullName} />;
}

function SignedInApp({ userId, fullName }: { userId: string; fullName: string | null }) {
  // App Attest / Play Integrity + device signals (lib/integrity.ts).
  useDeviceIntegrity();
  return (
    // Holds clock events made offline and sends them when the phone is back
    // online, whichever screen is open.
    <ClockProvider userId={userId}>
      {/* Sends incident reports submitted offline, likewise from any screen. */}
      <IncidentSyncProvider userId={userId}>
        {/* Sends signed forms submitted offline (form-sync.tsx). */}
        <FormSyncProvider userId={userId}>
          {/* Sends reading progress and quiz answers made offline (training-sync.tsx). */}
          <TrainingSyncProvider userId={userId}>
            {/* SOS: the floating button, countdown and alert screen sit above every screen. */}
            <SosProvider userId={userId} fullName={fullName}>
              {/* On-duty mode and welfare checks (welfare.tsx); the prompt sits above everything. */}
              <WelfareProvider userId={userId}>
                <View className="flex-1">
                  <Stack screenOptions={stackScreenOptions}>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    {/* The inbox, opened from the bell. */}
                    <Stack.Screen
                      name="notifications"
                      options={{ title: 'Notifications', headerBackTitle: 'Back' }}
                    />
                    {/* A staff member's view of an SOS (opened from the push). */}
                    <Stack.Screen
                      name="sos-alert/[id]"
                      options={{ title: 'SOS alert', headerBackTitle: 'Back' }}
                    />
                    {/* Forms (opened from the Home tile or a push). */}
                    <Stack.Screen
                      name="forms/index"
                      options={{ title: 'Forms', headerBackTitle: 'Back' }}
                    />
                    <Stack.Screen
                      name="forms/[id]"
                      options={{ title: 'Form', headerBackTitle: 'Back' }}
                    />
                    {/* Training (Home tile or a push). */}
                    <Stack.Screen
                      name="training/index"
                      options={{ title: 'Training', headerBackTitle: 'Back' }}
                    />
                    <Stack.Screen
                      name="training/[id]"
                      options={{ title: 'Lesson', headerBackTitle: 'Back' }}
                    />
                    <Stack.Screen
                      name="training/quiz/[id]"
                      options={{ title: 'Quiz', headerBackTitle: 'Back' }}
                    />
                    {/* The dimmed on-duty screen (opens at clock-in; Home card). */}
                    <Stack.Screen name="on-duty" options={{ headerShown: false }} />
                  </Stack>
                  <SosButton />
                </View>
                <SosCountdown />
                <SosScreen />
                <WelfarePrompt />
                <NotificationsBridge userId={userId} />
              </WelfareProvider>
            </SosProvider>
          </TrainingSyncProvider>
        </FormSyncProvider>
      </IncidentSyncProvider>
    </ClockProvider>
  );
}

/** Inbox refresh, app badge and opening tapped alerts (renders nothing). */
function NotificationsBridge({ userId }: { userId: string }) {
  useNotificationsBridge(userId);
  return null;
}
