import {
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  incidentCategoryLabel,
  toZoned,
} from '@deltaguard/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';

import { usePreventScreenCapture } from 'expo-screen-capture';

import { IncidentStatusBadge } from '@/components/incident-status';
import { dayLabel } from '@/components/shift-card';
import { Button, Card, ErrorState, InfoRow, Notice, SectionTitle, Title } from '@/components/ui';
import { fromReturned } from '@/lib/incident-form';
import { useIncidentSync } from '@/lib/incident-sync';
import { useIncident } from '@/lib/incidents';
import { useCompanySettings } from '@/lib/shifts';
import { brand, fx } from '@/lib/theme';

/** A report already on the server: read-only, unless it was returned. */
export default function IncidentScreen() {
  // Personal data, photos or answers on screen: no screenshots or recording.
  usePreventScreenCapture('incident');
  const { id } = useLocalSearchParams<{ id: string }>();
  const settings = useCompanySettings();
  const tz = settings.timeZone;
  const incident = useIncident(id);
  const { items, save } = useIncidentSync();
  const [opening, setOpening] = useState(false);
  const local = items.find((i) => i.id === id);

  if (incident.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
        <ActivityIndicator color={brand.gold} />
      </View>
    );
  }
  if (incident.isError || !incident.data) {
    return (
      <View className="flex-1 bg-ink p-5">
        <ErrorState
          message="Couldn't load this report."
          onRetry={() => void incident.refetch()}
          error={incident.error}
        />
      </View>
    );
  }
  const r = incident.data;
  const when = (iso: string) => `${dayLabel(iso, tz)} ${toZoned(iso, tz).time}`;

  async function edit() {
    setOpening(true);
    try {
      if (!local) await save(r.id, () => fromReturned(r, tz));
      router.replace({ pathname: '/reports/draft/[id]', params: { id: r.id } });
    } finally {
      setOpening(false);
    }
  }

  return (
    <ScrollView
      className="flex-1"
      style={fx.screen}
      contentContainerClassName="gap-4 p-5 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={incident.isRefetching}
          onRefresh={() => void incident.refetch()}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wider text-gold">
          {when(r.occurred_at)}
        </Text>
        <Title>{incidentCategoryLabel(r.category)}</Title>
        <Text className="text-base text-white/70">{r.sites?.name ?? 'Site'}</Text>
        <IncidentStatusBadge status={r.status} />
      </View>

      {r.status === 'returned' ? (
        <Card tone="warn">
          <Text className="text-base font-bold text-white">
            Your supervisor returned this report
          </Text>
          {r.review_notes ? (
            <Text className="text-base leading-6 text-white/85">{r.review_notes}</Text>
          ) : null}
          <Button
            title={local ? 'Continue editing' : 'Edit and resubmit'}
            loading={opening}
            onPress={() => void edit()}
          />
        </Card>
      ) : (
        <Notice tone="info">
          {r.status === 'approved'
            ? 'This report has been approved.'
            : 'Submitted reports can’t be changed. If something is wrong, tell your supervisor: they can return it to you.'}
        </Notice>
      )}

      <Card>
        <InfoRow label="Severity" value={INCIDENT_SEVERITY_LABELS[r.severity]} />
        <InfoRow label="What happened" value={r.description} />
        <InfoRow label="People involved" value={r.people_involved ?? 'None recorded'} />
        <InfoRow label="Police called" value={r.police_called ? 'Yes' : 'No'} />
      </Card>

      {r.photoUrls.length > 0 ? (
        <View className="gap-2">
          <SectionTitle>Photos</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {r.photoUrls.map((url, i) => (
              <Image
                key={url}
                source={{ uri: url }}
                style={{ width: 104, height: 104, borderRadius: 10 }}
                contentFit="cover"
                accessibilityLabel={`Photo ${i + 1}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View className="gap-2">
        <SectionTitle>History</SectionTitle>
        <Card>
          {r.history.map((h) => (
            <View key={h.id} className="gap-0.5">
              <Text className="text-sm font-semibold text-white">
                {INCIDENT_STATUS_LABELS[h.to_status]}
              </Text>
              <Text className="text-xs text-white/50">{when(h.changed_at)}</Text>
              {h.notes ? <Text className="text-sm leading-5 text-white/80">{h.notes}</Text> : null}
            </View>
          ))}
        </Card>
      </View>
    </ScrollView>
  );
}
