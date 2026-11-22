import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useUnreadCount } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { brand } from '@/lib/theme';

/** Header button that opens the inbox, with the unread count. */
export function NotificationBell() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <Bell userId={state.profile.id} />;
}

function Bell({ userId }: { userId: string }) {
  const unread = useUnreadCount(userId);
  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      hitSlop={10}
      className="mr-4 active:opacity-70"
    >
      <Ionicons
        name={unread > 0 ? 'notifications' : 'notifications-outline'}
        size={22}
        color={brand.gold}
      />
      {unread > 0 ? (
        <View className="absolute -right-2 -top-1.5 min-w-4 items-center rounded-full bg-red-500 px-1">
          <Text className="text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
