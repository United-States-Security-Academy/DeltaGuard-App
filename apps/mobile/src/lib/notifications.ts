import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { supabase } from './supabase';

// The in-app inbox: every alert the server sends also lands in the
// notifications table, whether or not the push reached the phone.

export const notificationKeys = {
  mine: (userId: string) => ['notifications', userId] as const,
};

export type InboxItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export function useInbox(userId: string) {
  return useQuery({
    queryKey: notificationKeys.mine(userId),
    queryFn: async (): Promise<InboxItem[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, data, read_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: (n.data ?? {}) as Record<string, unknown>,
        readAt: n.read_at,
        createdAt: n.created_at,
      }));
    },
  });
}

export function useUnreadCount(userId: string): number {
  const inbox = useInbox(userId);
  return (inbox.data ?? []).filter((n) => !n.readAt).length;
}

/** Marks these (or, with no ids, all unread) as read. */
export function useMarkRead(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      let query = supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('read_at', null);
      if (ids) query = query.in('id', ids);
      const { error } = await query;
      if (error) throw new Error(error.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.mine(userId) }),
  });
}

/** Where tapping an alert should go. */
export function routeFor(type: string, data: Record<string, unknown>): Href {
  const shiftId = typeof data.shift_id === 'string' ? data.shift_id : null;
  switch (type) {
    case 'shift_assigned':
    case 'shift_changed':
    case 'shift_cancelled':
    case 'shift_reminder':
      return shiftId ? { pathname: '/shifts/[id]', params: { id: shiftId } } : '/shifts';
    case 'licence_expiring':
      return typeof data.officer_id === 'string' ? '/notifications' : '/profile';
    default:
      // Supervisor alerts (missed/flagged clock-ins, incidents) are reviewed
      // in the admin console; the inbox shows the details.
      return '/notifications';
  }
}

/**
 * App-wide, while signed in: refresh the inbox when an alert arrives (Realtime
 * or a push while the app is open) or the app comes back, keep the app icon
 * badge in step, and open the right screen when an alert is tapped.
 */
export function useNotificationsBridge(userId: string) {
  const client = useQueryClient();
  const unread = useUnreadCount(userId);

  useEffect(() => {
    void Notifications.setBadgeCountAsync(unread).catch(() => undefined);
  }, [unread]);

  useEffect(() => {
    const refresh = () =>
      void client.invalidateQueries({ queryKey: notificationKeys.mine(userId) });
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe();
    const received = Notifications.addNotificationReceivedListener(refresh);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      void supabase.removeChannel(channel);
      received.remove();
      app.remove();
    };
  }, [client, userId]);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      const type = typeof data.type === 'string' ? data.type : '';
      const id = typeof data.notification_id === 'string' ? data.notification_id : null;
      if (id) {
        void supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', id)
          .is('read_at', null)
          .then(() => client.invalidateQueries({ queryKey: notificationKeys.mine(userId) }));
      }
      router.push(routeFor(type, data));
      void Notifications.clearLastNotificationResponseAsync();
    };
    // Tapped while the app was closed: it opened with this response.
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [client, userId]);
}
