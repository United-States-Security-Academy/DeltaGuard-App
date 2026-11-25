import { CHAT_MESSAGE_MAX_LENGTH } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { chatTime } from '@/components/chat';
import { ErrorState, Loading, Notice } from '@/components/ui';
import { choosePhotos, takePhoto } from '@/lib/incident-photos';
import {
  type Message,
  newMessageId,
  type Person,
  useAttachmentUrl,
  useConversationLive,
  useConversations,
  useMessages,
  usePeople,
  useSendMessage,
  warmUpChatPhoto,
} from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { brand, mutedWhite } from '@/lib/theme';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'ready' || !id) return null;
  return <Chat conversationId={id} userId={state.profile.id} />;
}

function Chat({ conversationId, userId }: { conversationId: string; userId: string }) {
  useConversationLive(conversationId, userId);
  const conversation = useConversations(userId).data?.find((c) => c.id === conversationId);
  const people = usePeople(conversationId);
  const messages = useMessages(conversationId);
  const send = useSendMessage(conversationId, userId);
  const [viewing, setViewing] = useState<string | null>(null);

  const names = useMemo(
    () => new Map((people.data ?? []).map((p) => [p.user_id, p.full_name ?? 'Unnamed'])),
    [people.data],
  );
  const list = useMemo(() => messages.data?.pages.flat() ?? [], [messages.data]);
  const isGroup = conversation?.type === 'group';
  // The newest message I sent that the server has: where the read receipt goes.
  const lastMine = list.find((m) => m.sender_id === userId && !m.pending);

  const title = (
    <Stack.Screen
      options={{
        title: conversation?.title ?? '',
        headerTitle: () => (
          <View className="items-center">
            <Text numberOfLines={1} className="text-base font-bold text-white">
              {conversation?.title ?? ''}
            </Text>
            {isGroup ? (
              <Text className="text-xs text-white/50">
                {(people.data ?? []).filter((p) => p.is_member).length} members
              </Text>
            ) : null}
          </View>
        ),
      }}
    />
  );

  if (messages.isPending)
    return (
      <>
        {title}
        <Loading />
      </>
    );
  if (messages.isError) {
    return (
      <>
        {title}
        <ErrorState
          message="Couldn’t load the messages."
          onRetry={() => void messages.refetch()}
          error={messages.error}
        />
      </>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
      className="flex-1 bg-ink"
    >
      {title}
      <FlatList
        inverted
        className="flex-1"
        contentContainerClassName="gap-1.5 px-4 py-3"
        data={list}
        keyExtractor={(m) => m.id}
        onEndReached={() => {
          if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          messages.isFetchingNextPage ? (
            <ActivityIndicator color={brand.gold} className="py-3" />
          ) : !messages.hasNextPage && list.length > 0 ? (
            <Text className="py-3 text-center text-xs text-white/40">
              Start of the conversation
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <View className="items-center p-8" style={{ transform: [{ scaleY: -1 }] }}>
            <Text className="text-center text-white/50">No messages yet. Say hello.</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const older = list[index + 1];
          const mine = item.sender_id === userId;
          // Names above the first of a run of someone else's messages, in groups.
          const showName = isGroup && !mine && older?.sender_id !== item.sender_id;
          return (
            <Bubble
              message={item}
              mine={mine}
              senderName={showName ? (names.get(item.sender_id) ?? 'Former member') : null}
              receipt={
                item.id === lastMine?.id
                  ? receiptFor(item, people.data ?? [], userId, isGroup)
                  : null
              }
              onRetry={() =>
                send.mutate({
                  id: item.id,
                  body: item.body ?? '',
                  photoUri: item.localUri ?? null,
                })
              }
              onOpenPhoto={setViewing}
            />
          );
        }}
      />
      <Composer onSend={(body, photoUri) => send.mutate({ id: newMessageId(), body, photoUri })} />
      <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />
    </KeyboardAvoidingView>
  );
}

/** "Seen" (1:1) or "Seen by 3" (group) once others have read up to this message. */
function receiptFor(message: Message, people: Person[], userId: string, isGroup: boolean): string {
  const others = people.filter((p) => p.is_member && p.user_id !== userId);
  const seen = others.filter((p) => p.last_read_at && p.last_read_at >= message.created_at);
  if (seen.length === 0) return 'Sent';
  if (!isGroup) return 'Seen';
  return seen.length === others.length ? 'Seen by everyone' : `Seen by ${seen.length}`;
}

function Bubble({
  message,
  mine,
  senderName,
  receipt,
  onRetry,
  onOpenPhoto,
}: {
  message: Message;
  mine: boolean;
  senderName: string | null;
  receipt: string | null;
  onRetry: () => void;
  onOpenPhoto: (uri: string) => void;
}) {
  const url = useAttachmentUrl(message.localUri ? null : message.attachment_path);
  const photo = message.localUri ?? url.data ?? null;
  const hasPhoto = Boolean(message.localUri || message.attachment_path);

  return (
    <View className={`max-w-[80%] gap-1 ${mine ? 'items-end self-end' : 'items-start self-start'}`}>
      {senderName ? <Text className="ml-3 mt-2 text-xs text-gold">{senderName}</Text> : null}
      <Pressable
        disabled={message.pending !== 'failed'}
        onPress={onRetry}
        className={`overflow-hidden rounded-2xl ${
          mine ? 'rounded-br-md bg-gold' : 'rounded-bl-md bg-navy'
        } ${message.pending === 'sending' ? 'opacity-70' : ''}`}
      >
        {hasPhoto ? (
          <Pressable onPress={() => photo && onOpenPhoto(photo)} accessibilityLabel="Open photo">
            {photo ? (
              <Image
                // Signed links change every hour; cache by the file instead.
                source={{
                  uri: photo,
                  cacheKey: message.localUri ? undefined : (message.attachment_path ?? undefined),
                }}
                cachePolicy="memory-disk"
                transition={150}
                style={{ width: 220, height: 220 }}
                contentFit="cover"
              />
            ) : (
              <View style={{ width: 220, height: 220 }} className="items-center justify-center">
                <ActivityIndicator color={mine ? brand.ink : brand.gold} />
              </View>
            )}
          </Pressable>
        ) : null}
        {message.body ? (
          <Text className={`px-3.5 py-2 text-base leading-6 ${mine ? 'text-ink' : 'text-white'}`}>
            {message.body}
          </Text>
        ) : null}
      </Pressable>
      <Text
        className={`mx-1 text-[11px] ${message.pending === 'failed' ? 'text-red-300' : 'text-white/40'}`}
      >
        {message.pending === 'sending'
          ? 'Sending…'
          : message.pending === 'failed'
            ? 'Not sent · tap to try again'
            : `${chatTime(message.created_at)}${receipt ? ` · ${receipt}` : ''}`}
      </Text>
    </View>
  );
}

function Composer({ onSend }: { onSend: (body: string, photoUri: string | null) => void }) {
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSend = body.trim().length > 0 || photo !== null;

  async function pick(source: 'camera' | 'library') {
    setError(null);
    const result = source === 'camera' ? await takePhoto() : await choosePhotos(1);
    if (result.kind === 'denied') setError(result.message);
    const uri = result.kind === 'picked' ? result.uris[0] : undefined;
    if (uri) {
      setPhoto(uri);
      warmUpChatPhoto(uri);
    }
  }

  function choosePhoto() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => void pick('camera') },
      { text: 'Choose from library', onPress: () => void pick('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function submit() {
    if (!canSend) return;
    onSend(body, photo);
    setBody('');
    setPhoto(null);
  }

  return (
    <View className="gap-2 border-t border-white/10 bg-ink px-3 pb-4 pt-2">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {photo ? (
        <View className="flex-row items-center gap-3">
          <Image source={{ uri: photo }} style={{ width: 56, height: 56, borderRadius: 12 }} />
          <Text className="flex-1 text-sm text-white/70">Photo attached</Text>
          <Pressable onPress={() => setPhoto(null)} accessibilityLabel="Remove photo" hitSlop={8}>
            <Ionicons name="close-circle" size={24} color={mutedWhite} />
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row items-end gap-2">
        <Pressable
          onPress={choosePhoto}
          accessibilityRole="button"
          accessibilityLabel="Add a photo"
          className="h-11 w-11 items-center justify-center rounded-full bg-navy active:opacity-70"
        >
          <Ionicons name="camera-outline" size={22} color={brand.gold} />
        </Pressable>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Message"
          placeholderTextColor={mutedWhite}
          selectionColor={brand.gold}
          cursorColor={brand.gold}
          keyboardAppearance="dark"
          multiline
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          className="max-h-32 min-h-11 flex-1 rounded-3xl bg-navy px-4 py-2.5 text-base text-white"
          accessibilityLabel="Message"
        />
        <Pressable
          onPress={submit}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          className={`h-11 w-11 items-center justify-center rounded-full ${
            canSend ? 'bg-gold active:opacity-80' : 'bg-navy'
          }`}
        >
          <Ionicons name="send" size={19} color={canSend ? brand.ink : mutedWhite} />
        </Pressable>
      </View>
    </View>
  );
}

function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-black/95">
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '80%' }} contentFit="contain" />
        ) : null}
        <Text className="mt-4 text-white/60">Tap to close</Text>
      </Pressable>
    </Modal>
  );
}
