import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useUnreadCount } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { brand, fx } from '@/lib/theme';

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
      hitSlop={8}
      className="mr-4 h-10 w-10 items-center justify-center rounded-full border border-gold/30 active:opacity-70"
      style={fx.glass}
    >
      <Ionicons
        name={unread > 0 ? 'notifications' : 'notifications-outline'}
        size={19}
        color={brand.gold}
      />
      {unread > 0 ? (
        <View className="absolute -right-1 -top-1 min-w-4 items-center rounded-full border border-ink bg-red-500 px-1">
          <Text className="text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
