import { formatDate, FORM_INBOX_STATUS_LABELS, toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useNow } from '@/components/clock-panel';
import { Badge, Body, Card, ErrorState, SectionTitle } from '@/components/ui';
import { newLocalForm } from '@/lib/form-store';
import { useFormSync } from '@/lib/form-sync';
import { buildLists, type MyFormLists, useMyForms } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { useCompanySettings } from '@/lib/shifts';
import { brand, fx } from '@/lib/theme';

export default function FormsScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <Forms userId={state.profile.id} />;
}

function Forms({ userId }: { userId: string }) {
  const forms = useMyForms(userId);
  const sync = useFormSync();
  const { timeZone } = useCompanySettings();
  const now = useNow(60_000);
  const lists = buildLists(forms.data, sync.items);

  const when = (iso: string) => {
    const z = toZoned(iso, timeZone);
    return `${formatDate(z.date)} ${z.time}`;
  };

  async function openTodo(item: MyFormLists['todo'][number]) {
    if (item.local) return router.push({ pathname: '/forms/[id]', params: { id: item.local.id } });
    if (item.server)
      return router.push({ pathname: '/forms/[id]', params: { id: item.server.id } });
    const a = item.assignment;
    if (!a) return;
    // A new draft, saved on the phone at once; its id becomes the server id.
    const id = Crypto.randomUUID();
    await sync.save(id, () => newLocalForm(id, a.templateId, a.version, a.id, a.title));
    router.push({ pathname: '/forms/[id]', params: { id } });
  }

  return (
    <ScrollView
      className="flex-1"
      style={fx.screen}
      contentContainerClassName="gap-4 p-5 pb-16"
      refreshControl={
        <RefreshControl
          refreshing={forms.isRefetching}
          onRefresh={() => {
            void forms.refetch();
            void sync.syncNow();
          }}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      {forms.isError && !forms.data ? (
        <ErrorState
          message="Couldn't load your forms."
          error={forms.error}
          onRetry={() => void forms.refetch()}
        />
      ) : null}

      <SectionTitle>To do</SectionTitle>
      {lists.todo.length === 0 ? (
        <Body>{forms.isPending ? 'Loading…' : 'Nothing to fill in right now.'}</Body>
      ) : (
        lists.todo.map((item) => {
          const overdue = item.dueAt !== null && Date.parse(item.dueAt) < now;
          return (
            <Row
              key={item.key}
              onPress={() => void openTodo(item)}
              icon="create-outline"
              title={item.title}
            >
              <View className="flex-row flex-wrap gap-2">
                {item.dueAt ? (
                  <Badge tone={overdue ? 'danger' : 'muted'}>
                    {overdue ? 'Overdue · ' : 'Due '}
                    {when(item.dueAt)}
                  </Badge>
                ) : null}
                {item.local?.state === 'failed' ? (
                  <Badge tone="danger">Needs fixing</Badge>
                ) : item.local || item.server ? (
                  <Badge tone="gold">In progress</Badge>
                ) : null}
              </View>
            </Row>
          );
        })
      )}

      <SectionTitle>Returned</SectionTitle>
      {lists.returned.length === 0 ? (
        <Body>No forms were sent back.</Body>
      ) : (
        lists.returned.map(({ server }) => (
          <Row
            key={server.id}
            onPress={() => router.push({ pathname: '/forms/[id]', params: { id: server.id } })}
            icon="arrow-undo-outline"
            title={server.title ?? 'Form'}
            tone="warn"
          >
            {server.reviewNotes ? (
              <Text className="text-sm leading-5 text-white/80" numberOfLines={3}>
                “{server.reviewNotes}”
              </Text>
            ) : null}
            <Badge tone="gold">Fix and submit again</Badge>
          </Row>
        ))
      )}

      <SectionTitle>Submitted</SectionTitle>
      {lists.submitted.length === 0 ? (
        <Body>Nothing submitted yet.</Body>
      ) : (
        lists.submitted.map(({ server, local }) => {
          const id = server?.id ?? local!.id;
          return (
            <Row
              key={id}
              onPress={() => router.push({ pathname: '/forms/[id]', params: { id } })}
              icon={
                server?.status === 'approved' ? 'checkmark-done-outline' : 'paper-plane-outline'
              }
              title={server?.title ?? local?.title ?? 'Form'}
            >
              <View className="flex-row flex-wrap gap-2">
                {local?.state === 'queued' ? (
                  <Badge tone="gold">
                    {sync.sendingId === id ? 'Sending…' : 'Waiting for signal'}
                  </Badge>
                ) : server ? (
                  <Badge tone={server.status === 'approved' ? 'gold' : 'muted'}>
                    {FORM_INBOX_STATUS_LABELS[server.status]}
                  </Badge>
                ) : null}
                {server?.submittedAt ? <Badge>{when(server.submittedAt)}</Badge> : null}
              </View>
            </Row>
          );
        })
      )}
    </ScrollView>
  );
}

function Row({
  title,
  icon,
  tone,
  onPress,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: 'warn';
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="active:opacity-80">
      <Card tone={tone}>
        <View className="flex-row items-center gap-3">
          <Ionicons name={icon} size={22} color={brand.gold} />
          <Text className="flex-1 text-base font-bold text-white">{title}</Text>
          <Ionicons name="chevron-forward" size={18} color={brand.gold} />
        </View>
        {children}
      </Card>
    </Pressable>
  );
}
