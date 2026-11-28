import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { NotificationBell } from '@/components/notification-bell';
import { useSession } from '@/lib/session';
import { brand, fx, headerInk } from '@/lib/theme';

// One header look for every navigator: ink bar, no divider, centred spaced
// title, gold back arrow. Top-level screens add the avatar (left, opens
// Profile) and the bell (right).

export const headerOptions = {
  // Same colour as the top of the page gradient, so header and page are one surface.
  headerStyle: { backgroundColor: headerInk },
  headerShadowVisible: false,
  headerTitleAlign: 'center' as const,
  headerTitleStyle: { color: brand.white, fontWeight: '800' as const, fontSize: 16 },
  headerTintColor: brand.gold,
};

/** For a Stack: the header plus the page gradient behind every screen. */
export const stackScreenOptions = {
  ...headerOptions,
  contentStyle: fx.backdrop,
};

/** Avatar on the left and bell on the right, for a tab's top screen. */
export const topLevelHeader = {
  headerLeft: () => <ProfileAvatar />,
  headerRight: () => <NotificationBell />,
};

function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** The signed-in person's initials in a gold ring; opens Profile. */
export function ProfileAvatar() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return (
    <Pressable
      onPress={() => router.navigate('/profile')}
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      hitSlop={8}
      className="ml-4 h-10 w-10 items-center justify-center rounded-full border-2 border-gold/80 active:opacity-70"
      style={[fx.glass, { boxShadow: '0px 0px 12px rgba(214,181,98,0.3)' }]}
    >
      <Text className="text-sm font-bold text-gold">{initials(state.profile.fullName)}</Text>
    </Pressable>
  );
}
