import {
  CHAT_ATTACHMENTS_BUCKET,
  CHAT_PAGE_SIZE,
  chatAttachmentPath,
  type Database,
  sendMessageSchema,
  SIGNED_URL_CACHE_MS,
  SIGNED_URL_MAX_SECONDS,
} from '@deltaguard/shared';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { supabase } from './supabase';

// Internal messaging. Reads go through RLS (members only); names come from the
// list_conversations / conversation_people / chat_contacts functions because
// officers can't read other people's profiles. Live updates use Realtime.

export type Conversation = Database['public']['Functions']['list_conversations']['Returns'][number];
export type Person = Database['public']['Functions']['conversation_people']['Returns'][number];
export type Contact = Database['public']['Functions']['chat_contacts']['Returns'][number];

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  created_at: string;
  /** Local only: still being sent, or failed. */
  pending?: 'sending' | 'failed';
  /** Local only: the photo on this phone while it uploads. */
  localUri?: string;
};

type Page = Message[];

export const chatKeys = {
  list: (userId: string) => ['chat', userId, 'list'] as const,
  messages: (conversationId: string) => ['chat', 'messages', conversationId] as const,
  people: (conversationId: string) => ['chat', 'people', conversationId] as const,
  contacts: (userId: string) => ['chat', userId, 'contacts'] as const,
  attachment: (path: string) => ['chat', 'attachment', path] as const,
};

const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, attachment_path, created_at';

// The conversation open on screen right now (push banners for it are skipped).
let openConversation: string | null = null;
export const getOpenConversation = () => openConversation;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function useConversations(userId: string) {
  return useQuery({
    queryKey: chatKeys.list(userId),
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await supabase.rpc('list_conversations');
      if (error) throw error;
      return data;
    },
  });
}

/** Unread messages across every conversation (tab badge, app icon badge). */
export function useUnreadMessageTotal(userId: string): number {
  const { data } = useConversations(userId);
  return (data ?? []).reduce((n, c) => n + c.unread_count, 0);
}

export function useChatContacts(userId: string) {
  return useQuery({
    queryKey: chatKeys.contacts(userId),
    queryFn: async (): Promise<Contact[]> => {
      const { data, error } = await supabase.rpc('chat_contacts');
      if (error) throw error;
      return data;
    },
  });
}

export function useStartDirect() {
  return useMutation({
    mutationFn: async (otherUserId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('start_direct_conversation', {
        p_user_id: otherUserId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/**
 * App-wide while signed in: a new message anywhere (Realtime, RLS-filtered to
 * the user's conversations) or the app coming back refreshes the list and counts.
 */
export function useChatListLive(userId: string) {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = () => void client.invalidateQueries({ queryKey: chatKeys.list(userId) });
    const channel = supabase
      .channel(`chat-list:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refresh)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_reads',
          filter: `user_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      void supabase.removeChannel(channel);
      app.remove();
    };
  }, [client, userId]);
}

// ---------------------------------------------------------------------------
// One conversation
// ---------------------------------------------------------------------------

export function usePeople(conversationId: string) {
  return useQuery({
    queryKey: chatKeys.people(conversationId),
    queryFn: async (): Promise<Person[]> => {
      const { data, error } = await supabase.rpc('conversation_people', {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      return data;
    },
  });
}

/** Newest first, CHAT_PAGE_SIZE at a time; older pages load as the user scrolls up. */
export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(conversationId),
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam }): Promise<Page> => {
      let query = supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(CHAT_PAGE_SIZE);
      if (pageParam) {
        query = query.or(
          `created_at.lt.${pageParam.at},and(created_at.eq.${pageParam.at},id.lt.${pageParam.id})`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last) => {
      const oldest = last.at(-1);
      return last.length === CHAT_PAGE_SIZE && oldest
        ? { at: oldest.created_at, id: oldest.id }
        : undefined;
    },
    // Live updates arrive through Realtime; don't refetch every page on focus.
    staleTime: Infinity,
  });
}

/** Puts a message at the top of the newest page (or replaces the copy with that id). */
function upsertMessage(
  data: InfiniteData<Page> | undefined,
  message: Message,
): InfiniteData<Page> | undefined {
  if (!data) return data;
  const exists = data.pages.some((p) => p.some((m) => m.id === message.id));
  const pages = exists
    ? data.pages.map((p) =>
        p.map((m) =>
          m.id === message.id
            ? // Keep showing the photo from this phone once the server copy
              // arrives, instead of downloading what we just uploaded.
              { ...message, localUri: message.localUri ?? m.localUri }
            : m,
        ),
      )
    : [[message, ...(data.pages[0] ?? [])], ...data.pages.slice(1)];
  return { ...data, pages };
}

/**
 * While a conversation is open: new messages and read receipts arrive live, the
 * conversation is marked read (now, on each new message and when the app comes
 * back), and push banners for it are skipped.
 */
export function useConversationLive(conversationId: string, userId: string) {
  const client = useQueryClient();

  useEffect(() => {
    openConversation = conversationId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const markRead = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (AppState.currentState !== 'active') return;
        void supabase
          .rpc('mark_conversation_read', { p_conversation_id: conversationId })
          .then(() => client.invalidateQueries({ queryKey: chatKeys.list(userId) }));
      }, 400);
    };
    markRead();

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const message = payload.new as Message;
          client.setQueryData<InfiniteData<Page>>(chatKeys.messages(conversationId), (d) =>
            upsertMessage(d, message),
          );
          if (message.sender_id !== userId) markRead();
          else void client.invalidateQueries({ queryKey: chatKeys.people(conversationId) });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_reads',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void client.invalidateQueries({ queryKey: chatKeys.people(conversationId) }),
      )
      .subscribe((status) => {
        // Reconnected: fetch anything missed while the socket was down.
        if (status === 'SUBSCRIBED') {
          void client.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
        }
      });

    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') markRead();
    });

    return () => {
      if (openConversation === conversationId) openConversation = null;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
      app.remove();
    };
  }, [client, conversationId, userId]);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Photos are decoded and re-encoded as a new JPEG (1280 px max, quality 0.6,
 * typically 100-300 KB): quick on a weak connection, and with no EXIF (GPS,
 * phone model). Started as soon as a photo is picked (warmUpChatPhoto), so it
 * is usually ready by the time Send is tapped; the same work is reused then.
 */
const CHAT_PHOTO_MAX_EDGE = 1280;
const CHAT_PHOTO_QUALITY = 0.6;
const preparedPhotos = new Map<string, Promise<string>>();

function prepareChatPhoto(sourceUri: string): Promise<string> {
  let prepared = preparedPhotos.get(sourceUri);
  if (!prepared) {
    prepared = (async () => {
      const image = await ImageManipulator.manipulate(sourceUri, {
        maxWidth: CHAT_PHOTO_MAX_EDGE,
        maxHeight: CHAT_PHOTO_MAX_EDGE,
      }).renderAsync();
      const saved = await image.saveAsync({
        compress: CHAT_PHOTO_QUALITY,
        format: SaveFormat.JPEG,
      });
      return saved.uri;
    })();
    // A failed attempt is forgotten so the next try starts again.
    prepared.catch(() => preparedPhotos.delete(sourceUri));
    preparedPhotos.set(sourceUri, prepared);
  }
  return prepared;
}

/** Start shrinking a picked photo in the background, before Send is tapped. */
export function warmUpChatPhoto(sourceUri: string): void {
  prepareChatPhoto(sourceUri).catch(() => {
    // Reported when the message is sent.
  });
}

function forgetChatPhoto(sourceUri: string, preparedUri: string): void {
  preparedPhotos.delete(sourceUri);
  try {
    new File(preparedUri).delete();
  } catch {
    // Cache file; the OS cleans it up anyway.
  }
}

export function useSendMessage(conversationId: string, userId: string) {
  const client = useQueryClient();
  const key = chatKeys.messages(conversationId);

  return useMutation({
    mutationFn: async (input: { id: string; body: string; photoUri: string | null }) => {
      let attachmentPath: string | null = null;
      if (input.photoUri) {
        const preparedUri = await prepareChatPhoto(input.photoUri);
        const bytes = await new File(preparedUri).bytes();
        // The message id names the file, so a retry reuses the same upload.
        attachmentPath = chatAttachmentPath(conversationId, userId, input.id, 'jpg');
        const { error } = await supabase.storage
          .from(CHAT_ATTACHMENTS_BUCKET)
          .upload(attachmentPath, bytes, { contentType: 'image/jpeg', upsert: false });
        if (error && !/already exists|duplicate/i.test(error.message)) {
          throw new Error(`Couldn’t upload the photo: ${error.message}`);
        }
        forgetChatPhoto(input.photoUri, preparedUri);
      }
      const row = sendMessageSchema.parse({
        id: input.id,
        conversation_id: conversationId,
        body: input.body,
        attachment_path: attachmentPath,
      });
      const { data, error } = await supabase
        .from('messages')
        .insert({ ...row, sender_id: userId })
        .select(MESSAGE_COLUMNS)
        .single();
      if (error) {
        // Sent by an earlier try whose answer was lost.
        if (error.code === '23505') return null;
        throw new Error(error.message);
      }
      return data;
    },
    onMutate: (input) => {
      const optimistic: Message = {
        id: input.id,
        conversation_id: conversationId,
        sender_id: userId,
        body: input.body.trim() || null,
        attachment_path: null,
        created_at: new Date().toISOString(),
        pending: 'sending',
        localUri: input.photoUri ?? undefined,
      };
      client.setQueryData<InfiniteData<Page>>(key, (d) => upsertMessage(d, optimistic));
    },
    onSuccess: (sent) => {
      if (sent) client.setQueryData<InfiniteData<Page>>(key, (d) => upsertMessage(d, sent));
      void client.invalidateQueries({ queryKey: chatKeys.list(userId) });
    },
    onError: (_error, input) => {
      client.setQueryData<InfiniteData<Page>>(key, (d) => {
        const current = d?.pages.flat().find((m) => m.id === input.id);
        return current ? upsertMessage(d, { ...current, pending: 'failed' }) : d;
      });
    },
  });
}

export const newMessageId = () => Crypto.randomUUID();

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** A short-lived link to a chat photo (private bucket). */
export function useAttachmentUrl(path: string | null) {
  return useQuery({
    queryKey: chatKeys.attachment(path ?? ''),
    enabled: Boolean(path),
    staleTime: SIGNED_URL_CACHE_MS,
    gcTime: SIGNED_URL_CACHE_MS,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(CHAT_ATTACHMENTS_BUCKET)
        .createSignedUrl(path!, SIGNED_URL_MAX_SECONDS);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
