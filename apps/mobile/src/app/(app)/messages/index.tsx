import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { ChatAvatar, chatTime, ROLE_LABEL, UnreadPill } from '@/components/chat';
import { NotificationBell } from '@/components/notification-bell';
import { Body, Button, ErrorState, Loading } from '@/components/ui';
import { type Conversation, useConversations } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { brand } from '@/lib/theme';

export default function MessagesScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return (
    <ConversationList userId={state.profile.id} isOfficer={state.profile.role === 'officer'} />
  );
}

function ConversationList({ userId, isOfficer }: { userId: string; isOfficer: boolean }) {
  const conversations = useConversations(userId);

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <View className="flex-row items-center gap-1">
            <Pressable
              onPress={() => router.push('/messages/new')}
              accessibilityRole="button"
              accessibilityLabel="New message"
              hitSlop={10}
              className="mr-3 active:opacity-70"
            >
              <Ionicons name="create-outline" size={23} color={brand.gold} />
            </Pressable>
            <NotificationBell />
          </View>
        ),
      }}
    />
  );

  if (conversations.isPending)
    return (
      <>
        {header}
        <Loading />
      </>
    );
  if (conversations.isError) {
    return (
      <>
        {header}
        <ErrorState
          message="Couldn’t load your conversations."
          onRetry={() => void conversations.refetch()}
          error={conversations.error}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <FlatList
        className="flex-1 bg-ink"
        data={conversations.data}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl
            refreshing={conversations.isRefetching}
            onRefresh={() => void conversations.refetch()}
            tintColor={brand.gold}
          />
        }
        ItemSeparatorComponent={() => <View className="ml-20 h-px bg-white/5" />}
        renderItem={({ item }) => <Row conversation={item} userId={userId} />}
        ListEmptyComponent={
          <View className="gap-4 p-6">
            <Body>
              {isOfficer
                ? 'No conversations yet. Message a supervisor, or wait for one to add you to a group.'
                : 'No conversations yet.'}
            </Body>
            <Button
              title={isOfficer ? 'Message a supervisor' : 'New message'}
              onPress={() => router.push('/messages/new')}
            />
          </View>
        }
      />
    </>
  );
}

function Row({ conversation: c, userId }: { conversation: Conversation; userId: string }) {
  const unread = c.unread_count > 0;
  const preview = c.last_message_preview
    ? `${c.last_message_sender_id === userId ? 'You: ' : ''}${c.last_message_preview}`
    : c.type === 'group'
      ? `${c.member_count} members`
      : 'No messages yet';
  const subtitle = c.type === 'direct' && c.other_user_role ? ROLE_LABEL[c.other_user_role] : null;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/messages/[id]', params: { id: c.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${c.title}${unread ? `, ${c.unread_count} unread` : ''}`}
      className="flex-row items-center gap-4 px-5 py-3.5 active:bg-navy"
    >
      <ChatAvatar name={c.title} group={c.type === 'group'} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className={`flex-1 text-base text-white ${unread ? 'font-bold' : 'font-semibold'}`}
          >
            {c.title}
            {subtitle ? (
              <Text className="text-xs font-normal text-white/50"> · {subtitle}</Text>
            ) : null}
          </Text>
          {c.last_message_at ? (
            <Text className={`text-xs ${unread ? 'text-gold' : 'text-white/50'}`}>
              {chatTime(c.last_message_at)}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className={`flex-1 text-sm ${unread ? 'text-white' : 'text-white/60'}`}
          >
            {preview}
          </Text>
          <UnreadPill count={c.unread_count} />
        </View>
      </View>
    </Pressable>
  );
}
