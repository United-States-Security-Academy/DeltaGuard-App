import { toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Markdown } from '@/components/markdown';
import { Badge, Button, Card, ErrorState, Notice, SectionTitle } from '@/components/ui';
import {
  isAcknowledged,
  type PostOrder,
  useAcknowledgePostOrder,
  useSitePostOrders,
} from '@/lib/post-orders';
import { brand } from '@/lib/theme';

/** One post order: title, status, the instructions, and the acknowledge button. */
function PostOrderCard({
  order,
  siteId,
  userId,
  timeZone,
  startOpen,
}: {
  order: PostOrder;
  siteId: string;
  userId: string;
  timeZone: string;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const acknowledge = useAcknowledgePostOrder(siteId, userId);
  const done = isAcknowledged(order);
  const updated = !done && order.acknowledgedVersion !== null;
  const published = toZoned(order.publishedAt, timeZone);

  return (
    <Card tone={done ? 'default' : 'warn'}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-start gap-3 active:opacity-70"
      >
        <View className="flex-1 gap-1.5">
          <Text className="text-lg font-bold text-white">{order.title}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {done ? (
              <Badge>Acknowledged</Badge>
            ) : (
              <Badge tone="gold">{updated ? 'Updated: read again' : 'Read and acknowledge'}</Badge>
            )}
            <Badge>
              Version {order.version} · {published.date}
            </Badge>
          </View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={brand.gold} />
      </Pressable>

      {open ? (
        <View className="gap-4 border-t border-white/10 pt-3">
          <Markdown source={order.body} />
          {done ? null : (
            <View className="gap-2">
              <Button
                title="I have read and understood"
                loading={acknowledge.isPending}
                onPress={() => acknowledge.mutate(order)}
              />
              {acknowledge.isError ? (
                <Notice tone="error">Couldn&apos;t acknowledge: {acknowledge.error.message}</Notice>
              ) : null}
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

/** Post orders section of the shift screen. */
export function PostOrdersSection({
  siteId,
  userId,
  timeZone,
}: {
  siteId: string;
  userId: string;
  timeZone: string;
}) {
  const orders = useSitePostOrders(siteId, userId);
  if (orders.isError) {
    return (
      <View className="gap-2">
        <SectionTitle>Post orders</SectionTitle>
        <ErrorState
          message="Couldn't load the post orders."
          onRetry={() => void orders.refetch()}
        />
      </View>
    );
  }
  if (!orders.data || orders.data.length === 0) return null;
  const pending = orders.data.filter((o) => !isAcknowledged(o)).length;

  return (
    <View className="gap-3">
      <SectionTitle>Post orders</SectionTitle>
      {pending > 0 ? (
        <Notice tone="info">
          Read and acknowledge {pending === 1 ? 'the post order' : `all ${pending} post orders`}{' '}
          marked in gold. You can&apos;t clock in here until you do.
        </Notice>
      ) : null}
      {orders.data.map((o) => (
        <PostOrderCard
          key={`${o.id}:${o.version}`}
          order={o}
          siteId={siteId}
          userId={userId}
          timeZone={timeZone}
          startOpen={false}
        />
      ))}
    </View>
  );
}

/**
 * Full-screen step before a clock-in: every post order the officer still has
 * to acknowledge. `onDone` continues to the clock-in once none are left.
 */
export function PostOrdersGate({
  visible,
  siteId,
  siteName,
  userId,
  timeZone,
  onDone,
  onCancel,
}: {
  visible: boolean;
  siteId: string;
  siteName: string;
  userId: string;
  timeZone: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const orders = useSitePostOrders(visible ? siteId : null, userId);
  const all = orders.data ?? [];
  const remaining = all.filter((o) => !isAcknowledged(o)).length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView className="flex-1 bg-ink">
        <View className="flex-row items-center justify-between border-b border-white/10 px-5 py-3">
          <Text className="flex-1 text-lg font-bold text-white">Post orders</Text>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
          >
            <Ionicons name="close" size={24} color={brand.white} />
          </Pressable>
        </View>
        <ScrollView contentContainerClassName="gap-4 p-5 pb-10">
          <Text className="text-base leading-6 text-white/80">
            Before you clock in at {siteName}, read and acknowledge the latest post orders.
          </Text>
          {orders.isError ? (
            <ErrorState
              message="Couldn't load the post orders. Check your connection."
              onRetry={() => void orders.refetch()}
            />
          ) : null}
          {all.map((o) => (
            <PostOrderCard
              key={`${o.id}:${o.version}`}
              order={o}
              siteId={siteId}
              userId={userId}
              timeZone={timeZone}
              // Open the ones still to read; acknowledged ones stay collapsed.
              startOpen={!isAcknowledged(o)}
            />
          ))}
          {orders.isSuccess && remaining === 0 ? (
            <View className="gap-3">
              <Notice tone="info">All post orders acknowledged.</Notice>
              <Button title="Continue to clock in" onPress={onDone} />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
