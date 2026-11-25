import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';

import { EmergencyInstructions, SiteContacts } from '@/components/site-info';
import { Body, Button, Card, ErrorState, Notice, Title } from '@/components/ui';
import { openDirections } from '@/lib/directions';
import { type MySite, useMySites } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { brand } from '@/lib/theme';

export default function SitesScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <MySites userId={state.profile.id} />;
}

function MySites({ userId }: { userId: string }) {
  const sites = useMySites(userId);

  return (
    <ScrollView
      className="flex-1 bg-ink"
      contentContainerClassName="gap-4 p-5 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={sites.isRefetching}
          onRefresh={() => void sites.refetch()}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      <View className="gap-1">
        <Title>My sites</Title>
        <Body>Where you are assigned to work.</Body>
      </View>

      {sites.isPending ? (
        <ActivityIndicator color={brand.gold} />
      ) : sites.isError ? (
        <ErrorState
          message="Couldn't load your sites."
          onRetry={() => void sites.refetch()}
          error={sites.error}
        />
      ) : sites.data.length === 0 ? (
        <Card>
          <Text className="text-base text-white/80">
            You aren&apos;t assigned to any sites yet. Your supervisor will let you know where
            you&apos;re posted.
          </Text>
        </Card>
      ) : (
        sites.data.map((site) => <SiteCard key={site.id} site={site} />)
      )}
    </ScrollView>
  );
}

function SiteCard({ site }: { site: MySite }) {
  const [directionsError, setDirectionsError] = useState<string | null>(null);
  const canNavigate = (site.latitude !== null && site.longitude !== null) || Boolean(site.address);

  return (
    <Card>
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-gold/15">
          <Ionicons name="shield-checkmark" size={20} color={brand.gold} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-lg font-bold text-white">{site.name}</Text>
          <Text className="text-sm leading-5 text-white/70">
            {site.address ?? 'No address recorded'}
          </Text>
        </View>
      </View>

      <EmergencyInstructions text={site.emergencyInstructions} />
      <SiteContacts contacts={site.contacts} />

      {canNavigate ? (
        <Button
          title="Get directions"
          onPress={async () => {
            setDirectionsError(null);
            const opened = await openDirections(site);
            if (!opened) setDirectionsError('No maps app could open these directions.');
          }}
        />
      ) : (
        <Text className="text-sm text-white/50">
          No location recorded for this site yet, so directions aren&apos;t available.
        </Text>
      )}
      {directionsError ? <Notice tone="error">{directionsError}</Notice> : null}
    </Card>
  );
}
