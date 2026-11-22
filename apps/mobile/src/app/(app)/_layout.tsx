import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { NotificationBell } from '@/components/notification-bell';
import { ClockProvider } from '@/lib/clock';
import { IncidentSyncProvider } from '@/lib/incident-sync';
import { useNotificationsBridge } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { canSeeTab, type TabName } from '@/lib/tabs';
import { brand, mutedWhite } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: TabName; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline' },
  { name: 'shifts', title: 'Shifts', icon: 'calendar-outline' },
  { name: 'sites', title: 'Sites', icon: 'location-outline' },
  { name: 'reports', title: 'Reports', icon: 'document-text-outline' },
  { name: 'messages', title: 'Messages', icon: 'chatbubbles-outline' },
  { name: 'profile', title: 'Profile', icon: 'person-circle-outline' },
];

export default function AppTabsLayout() {
  const { state } = useSession();
  // The root layout only renders this group when signed in.
  if (state.status !== 'ready') return null;
  const role = state.profile.role;

  return (
    // Holds clock events made offline and sends them when the phone is back
    // online, whichever tab is open.
    <ClockProvider userId={state.profile.id}>
      {/* Sends incident reports submitted offline, likewise from any tab. */}
      <IncidentSyncProvider userId={state.profile.id}>
        <Tabs
          screenOptions={{
            headerShown: true,
            headerStyle: { backgroundColor: brand.ink },
            headerTitleStyle: { color: brand.white, fontWeight: '700' },
            tabBarActiveTintColor: brand.gold,
            tabBarInactiveTintColor: mutedWhite,
            tabBarStyle: { backgroundColor: brand.navy },
            headerRight: () => <NotificationBell />,
          }}
        >
          {TABS.map((tab) => (
            <Tabs.Screen
              key={tab.name}
              name={tab.name}
              options={{
                title: tab.title,
                // Shifts and Reports have their own stacks with their own headers.
                ...(tab.name === 'shifts' || tab.name === 'reports' ? { headerShown: false } : {}),
                // href: null hides the tab button for roles that don't use it.
                ...(canSeeTab(tab.name, role) ? {} : { href: null }),
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name={tab.icon} color={String(color)} size={size} />
                ),
              }}
            />
          ))}
          {/* The inbox: opened from the bell, not shown in the tab bar. */}
          <Tabs.Screen name="notifications" options={{ title: 'Notifications', href: null }} />
        </Tabs>
        <NotificationsBridge userId={state.profile.id} />
      </IncidentSyncProvider>
    </ClockProvider>
  );
}

/** Inbox refresh, app badge and opening tapped alerts (renders nothing). */
function NotificationsBridge({ userId }: { userId: string }) {
  useNotificationsBridge(userId);
  return null;
}
