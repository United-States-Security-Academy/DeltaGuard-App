import { friendlyError } from '@deltaguard/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { ChatAvatar, ROLE_LABEL } from '@/components/chat';
import { Body, ErrorState, Loading, Notice } from '@/components/ui';
import { type Contact, useChatContacts, useStartDirect } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { brand, mutedWhite } from '@/lib/theme';

/**
 * Start (or reopen) a 1:1 chat. Officers see supervisors; admins and supervisors
 * see everyone. Groups are created in the admin console.
 */
export default function NewMessageScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <Contacts userId={state.profile.id} isOfficer={state.profile.role === 'officer'} />;
}

function Contacts({ userId, isOfficer }: { userId: string; isOfficer: boolean }) {
  const contacts = useChatContacts(userId);
  const start = useStartDirect();
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  if (contacts.isPending) return <Loading />;
  if (contacts.isError) {
    return (
      <ErrorState
        message="Couldn’t load your contacts."
        onRetry={() => void contacts.refetch()}
        error={contacts.error}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = contacts.data.filter(
    (c) => !needle || (c.full_name ?? '').toLowerCase().includes(needle),
  );

  function open(contact: Contact) {
    setOpening(contact.user_id);
    start.mutate(contact.user_id, {
      onSuccess: (id) => router.replace({ pathname: '/messages/[id]', params: { id } }),
      onSettled: () => setOpening(null),
    });
  }

  return (
    <View className="flex-1 bg-ink">
      <View className="gap-3 p-5 pb-2">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={isOfficer ? 'Search supervisors' : 'Search people'}
          placeholderTextColor={mutedWhite}
          selectionColor={brand.gold}
          keyboardAppearance="dark"
          autoCorrect={false}
          className="rounded-2xl border border-white/10 bg-navy px-4 py-3 text-base text-white"
          accessibilityLabel="Search"
        />
        {start.isError ? (
          <Notice tone="error">{friendlyError(start.error, { action: 'start the chat' })}</Notice>
        ) : null}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(c) => c.user_id}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View className="ml-20 h-px bg-white/5" />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            disabled={opening !== null}
            accessibilityRole="button"
            accessibilityLabel={`Message ${item.full_name ?? 'this person'}`}
            className="flex-row items-center gap-4 px-5 py-3 active:bg-navy"
          >
            <ChatAvatar name={item.full_name} size={40} />
            <View className="flex-1">
              <Text className="text-base font-semibold text-white">
                {item.full_name ?? 'Unnamed'}
              </Text>
              <Text className="text-xs text-white/50">{ROLE_LABEL[item.role] ?? item.role}</Text>
            </View>
            {opening === item.user_id ? <ActivityIndicator color={brand.gold} /> : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <View className="p-5">
            <Body>{needle ? 'Nobody matches.' : 'Nobody to message yet.'}</Body>
          </View>
        }
      />
    </View>
  );
}
