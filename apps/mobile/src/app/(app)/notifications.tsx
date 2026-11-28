import { toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { dayLabel } from '@/components/shift-card';
import { Body, Button, ErrorState } from '@/components/ui';
import { type InboxItem, routeFor, useInbox, useMarkRead } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { useCompanySettings } from '@/lib/shifts';
import { brand, fx } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<string, IconName> = {
  shift_assigned: 'calendar-outline',
  shift_changed: 'calendar-outline',
  shift_cancelled: 'close-circle-outline',
  shift_reminder: 'alarm-outline',
  clock_in_missed: 'alert-circle-outline',
  clock_in_flagged: 'flag-outline',
  licence_expiring: 'id-card-outline',
  incident_submitted: 'warning-outline',
};

export default function NotificationsScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <Inbox userId={state.profile.id} />;
}

function Inbox({ userId }: { userId: string }) {
  const inbox = useInbox(userId);
  const markRead = useMarkRead(userId);
  const { timeZone } = useCompanySettings();
  const items = inbox.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  function open(item: InboxItem) {
    if (!item.readAt) markRead.mutate([item.id]);
    const route = routeFor(item.type, item.data);
    // navigate, not push: a shift or chat opens in the existing tabs (closing
    // the inbox) instead of stacking a second tab bar on top of it.
    if (route !== '/notifications') router.navigate(route);
  }

  if (inbox.isPending) {
    return (
      <View className="flex-1 items-center justify-center" style={fx.screen}>
        <ActivityIndicator color={brand.gold} />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      style={fx.screen}
      contentContainerClassName="gap-3 p-5 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={inbox.isRefetching}
          onRefresh={() => void inbox.refetch()}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      {inbox.isError ? (
        <ErrorState
          message="Couldn't load your notifications."
          onRetry={() => void inbox.refetch()}
          error={inbox.error}
        />
      ) : null}
      {unread > 0 ? (
        <Button
          title={`Mark all as read (${unread})`}
          variant="secondary"
          loading={markRead.isPending}
          onPress={() => markRead.mutate(undefined)}
        />
      ) : null}
      {inbox.isSuccess && items.length === 0 ? <Body>No notifications yet.</Body> : null}
      {items.map((n) => (
        <Pressable
          key={n.id}
          onPress={() => open(n)}
          accessibilityRole="button"
          accessibilityState={{ selected: !n.readAt }}
          className={`flex-row gap-4 rounded-3xl border p-4 active:opacity-70 ${
            n.readAt ? 'border-white/[0.06] opacity-80' : 'border-gold/45'
          }`}
          style={n.readAt ? fx.glass : fx.glassGlow}
        >
          <View
            className={`h-11 w-11 items-center justify-center rounded-full border ${
              n.readAt ? 'border-white/15' : 'border-gold/70 bg-gold/10'
            }`}
          >
            <Ionicons
              name={ICONS[n.type] ?? 'notifications-outline'}
              size={20}
              color={n.readAt ? 'rgba(255,255,255,0.6)' : brand.gold}
            />
          </View>
          <View className="flex-1 gap-1">
            <View className="flex-row items-start gap-2">
              <Text
                className={`flex-1 text-base ${n.readAt ? 'text-white/80' : 'font-bold text-white'}`}
              >
                {n.title}
              </Text>
              {!n.readAt ? <View className="mt-1.5 h-2 w-2 rounded-full bg-gold" /> : null}
            </View>
            {n.body ? <Text className="text-sm leading-5 text-white/70">{n.body}</Text> : null}
            <Text className="text-xs text-white/45">
              {dayLabel(n.createdAt, timeZone)} {toZoned(n.createdAt, timeZone).time}
            </Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
