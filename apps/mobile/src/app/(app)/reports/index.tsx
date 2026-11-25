import { incidentCategoryLabel, INCIDENT_SEVERITY_LABELS, toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useNow } from '@/components/clock-panel';
import { IncidentStatusBadge, SyncLine } from '@/components/incident-status';
import { dayLabel } from '@/components/shift-card';
import { Badge, Body, Button, Card, ErrorState, Notice, SectionTitle } from '@/components/ui';
import { currentShift, useClock } from '@/lib/clock';
import { newIncident } from '@/lib/incident-form';
import type { LocalIncident } from '@/lib/incident-store';
import { useIncidentSync } from '@/lib/incident-sync';
import { useMyIncidents } from '@/lib/incidents';
import { useMySites } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useCompanySettings, useMyShifts } from '@/lib/shifts';
import { brand } from '@/lib/theme';

export default function ReportsScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <Reports userId={state.profile.id} />;
}

function Reports({ userId }: { userId: string }) {
  const settings = useCompanySettings();
  const tz = settings.timeZone;
  const { items, save, syncNow, sendingId } = useIncidentSync();
  const server = useMyIncidents(userId);
  const sites = useMySites(userId);
  const shifts = useMyShifts(userId);
  const { pending } = useClock();
  const now = useNow();
  const [creating, setCreating] = useState(false);

  const siteName = (id: string | null) =>
    sites.data?.find((s) => s.id === id)?.name ?? (id ? 'Site' : 'No site chosen');
  const local = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  const localIds = new Set(local.map((i) => i.id));
  const sent = (server.data ?? []).filter((i) => !localIds.has(i.id));
  const queued = local.filter((i) => i.state === 'queued');

  async function create() {
    setCreating(true);
    try {
      // Start with the site of the shift the officer is on (or about to be).
      const shift = currentShift(shifts.data ?? [], settings, pending, now);
      const id = Crypto.randomUUID();
      await save(id, () =>
        newIncident(id, tz, { siteId: shift?.site?.id ?? null, shiftId: shift?.id ?? null }),
      );
      router.push({ pathname: '/reports/draft/[id]', params: { id } });
    } finally {
      setCreating(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-ink"
      contentContainerClassName="gap-4 p-5 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={server.isRefetching}
          onRefresh={() => {
            void server.refetch();
            void syncNow();
          }}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      <Button title="New incident report" loading={creating} onPress={() => void create()} />
      <Text className="text-xs leading-4 text-white/50">
        Reports are saved on this phone as you type, and sent as soon as there is a connection.
      </Text>

      {local.length > 0 ? (
        <View className="gap-3">
          <SectionTitle>On this phone</SectionTitle>
          {local.map((item) => (
            <LocalCard key={item.id} item={item} siteName={siteName(item.form.siteId)} tz={tz} />
          ))}
          {queued.length > 0 && !sendingId ? (
            <Button title="Try sending now" variant="secondary" onPress={() => void syncNow()} />
          ) : null}
        </View>
      ) : null}

      <View className="gap-3">
        <SectionTitle>Sent reports</SectionTitle>
        {server.isError ? (
          <ErrorState
            message="Couldn't load your reports. Reports on this phone are still safe."
            onRetry={() => void server.refetch()}
            error={server.error}
          />
        ) : sent.length === 0 && server.isSuccess ? (
          <Body>No incident reports yet.</Body>
        ) : (
          sent.map((r) => (
            <Pressable
              key={r.id}
              onPress={() =>
                router.push({ pathname: '/reports/incident/[id]', params: { id: r.id } })
              }
              accessibilityRole="button"
              className="active:opacity-70"
            >
              <Card tone={r.status === 'returned' ? 'warn' : 'default'}>
                <View className="flex-row items-start gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-gold">
                      {dayLabel(r.occurred_at, tz)} {toZoned(r.occurred_at, tz).time}
                    </Text>
                    <Text className="text-lg font-bold text-white">
                      {incidentCategoryLabel(r.category)}
                    </Text>
                    <Text className="text-sm text-white/70">{r.sites?.name ?? 'Site'}</Text>
                    <View className="mt-1 flex-row flex-wrap gap-1.5">
                      <IncidentStatusBadge status={r.status} />
                      <Badge
                        tone={
                          r.severity === 'critical' || r.severity === 'high' ? 'danger' : 'muted'
                        }
                      >
                        {INCIDENT_SEVERITY_LABELS[r.severity]}
                      </Badge>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={brand.gold} />
                </View>
                {r.status === 'returned' && r.review_notes ? (
                  <Notice tone="info">{r.review_notes}</Notice>
                ) : null}
              </Card>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function LocalCard({ item, siteName, tz }: { item: LocalIncident; siteName: string; tz: string }) {
  const title = item.form.category
    ? incidentCategoryLabel(item.form.category)
    : item.form.description.trim().slice(0, 40) || 'New incident report';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/reports/draft/[id]', params: { id: item.id } })}
      accessibilityRole="button"
      className="active:opacity-70"
    >
      <Card
        tone={item.state === 'failed' ? 'danger' : item.state === 'queued' ? 'warn' : 'default'}
      >
        <View className="flex-row items-start gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wider text-gold">
              {item.form.date && item.form.time
                ? `${item.form.date} ${item.form.time}`
                : `Edited ${toZoned(new Date(item.updatedAt), tz).time}`}
              {item.mode === 'resubmit' ? ' · resubmission' : ''}
            </Text>
            <Text className="text-lg font-bold text-white">{title}</Text>
            <Text className="text-sm text-white/70">{siteName}</Text>
            <View className="mt-1">
              <SyncLine item={item} timeZone={tz} />
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={brand.gold} />
        </View>
      </Card>
    </Pressable>
  );
}
