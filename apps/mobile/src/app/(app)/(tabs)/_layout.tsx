import type { UserRole } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, ThemeProvider, useTheme } from 'expo-router';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headerOptions, topLevelHeader } from '@/components/header';
import { useUnreadMessageTotal } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { canSeeTab, type TabName } from '@/lib/tabs';
import { brand, fx, slabGold, TAB_BAR_HEIGHT } from '@/lib/theme';

/** Rounded bottom corners of the page where it meets the gold slab. */
const SLAB_RADIUS = 34;

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: TabName; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'shifts', title: 'Shifts', icon: 'calendar-outline', active: 'calendar' },
  { name: 'sites', title: 'Sites', icon: 'location-outline', active: 'location' },
  { name: 'reports', title: 'Reports', icon: 'document-text-outline', active: 'document-text' },
  { name: 'messages', title: 'Messages', icon: 'chatbubbles-outline', active: 'chatbubbles' },
  { name: 'profile', title: 'Profile', icon: 'person-circle-outline', active: 'person-circle' },
];

// Only real tabs live here. Since SDK 58, Expo Router sends a focused tab that
// is hidden (href: null) straight back to the first tab, so screens opened from
// elsewhere (the inbox, an SOS alert) are pushed by the stack in (app)/_layout.
export default function TabsLayout() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <SignedInTabs userId={state.profile.id} role={state.profile.role} />;
}

function SignedInTabs({ userId, role }: { userId: string; role: UserRole }) {
  const unreadMessages = useUnreadMessageTotal(userId);
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  // The concept's look: the page sits on a bright slab (here the gold tab
  // bar). Each screen has rounded bottom corners, and the navigator's
  // background behind them is the slab's gold, so the page appears to rest on
  // the slab.
  return (
    <ThemeProvider value={{ ...theme, colors: { ...theme.colors, background: slabGold } }}>
      <View className="flex-1" style={{ backgroundColor: slabGold }}>
        <Tabs
          screenOptions={{
            ...headerOptions,
            ...topLevelHeader,
            headerShown: true,
            sceneStyle: {
              ...fx.backdrop,
              borderBottomLeftRadius: SLAB_RADIUS,
              borderBottomRightRadius: SLAB_RADIUS,
              overflow: 'hidden',
            },
            tabBarActiveTintColor: brand.ink,
            tabBarInactiveTintColor: 'rgba(5,14,29,0.62)',
            tabBarStyle: {
              ...fx.tabBar,
              height: TAB_BAR_HEIGHT + insets.bottom,
              paddingTop: 8,
              borderTopWidth: 0,
              elevation: 0,
            },
            tabBarLabelStyle: {
              fontSize: 10,
              fontWeight: '800',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
            },
          }}
        >
          {TABS.map((tab) => (
            <Tabs.Screen
              key={tab.name}
              name={tab.name}
              options={{
                title: tab.title,
                // Shifts, Reports and Messages have their own stacks with their own headers.
                ...(tab.name === 'shifts' || tab.name === 'reports' || tab.name === 'messages'
                  ? { headerShown: false }
                  : {}),
                ...(tab.name === 'messages' && unreadMessages > 0
                  ? {
                      tabBarBadge: unreadMessages > 99 ? '99+' : unreadMessages,
                      tabBarBadgeStyle: { backgroundColor: brand.ink, color: brand.gold },
                    }
                  : {}),
                // href: null hides the tab for roles that don't use it (and the
                // router sends them back to Home if they reach it by URL).
                ...(canSeeTab(tab.name, role) ? {} : { href: null }),
                // Active: a dark ink pill with a gold icon, cut into the gold slab.
                tabBarIcon: ({ color, focused }) => (
                  <View
                    className="h-8 w-12 items-center justify-center rounded-full"
                    style={
                      focused
                        ? {
                            backgroundColor: brand.ink,
                            boxShadow: '0px 4px 10px rgba(5,14,29,0.35)',
                          }
                        : undefined
                    }
                  >
                    <Ionicons
                      name={focused ? tab.active : tab.icon}
                      color={focused ? brand.gold : String(color)}
                      size={21}
                    />
                  </View>
                ),
              }}
            />
          ))}
        </Tabs>
      </View>
    </ThemeProvider>
  );
}
