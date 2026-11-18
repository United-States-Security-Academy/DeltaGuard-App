import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { useSession } from '@/lib/session';
import { canSeeTab, type TabName } from '@/lib/tabs';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: TabName; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline' },
  { name: 'shifts', title: 'Shifts', icon: 'calendar-outline' },
  { name: 'reports', title: 'Reports', icon: 'document-text-outline' },
  { name: 'messages', title: 'Messages', icon: 'chatbubbles-outline' },
  { name: 'profile', title: 'Profile', icon: 'person-circle-outline' },
];

export default function AppTabsLayout() {
  const { state } = useSession();
  // The root layout only renders this group when signed in.
  const role = state.status === 'ready' ? state.profile.role : 'officer';

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            // href: null hides the tab button for roles that don't use it.
            ...(canSeeTab(tab.name, role) ? {} : { href: null }),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={tab.icon} color={String(color)} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
