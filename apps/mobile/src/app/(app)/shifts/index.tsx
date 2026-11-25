import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';

import { ClockQueueStatus, useNow } from '@/components/clock-panel';
import { ShiftCard } from '@/components/shift-card';
import { Body, Card, ErrorState, SectionTitle } from '@/components/ui';
import { currentShift, useClock } from '@/lib/clock';
import { useSession } from '@/lib/session';
import { useCompanySettings, useMyShifts } from '@/lib/shifts';
import { brand } from '@/lib/theme';

export default function ShiftsScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <MyShifts userId={state.profile.id} />;
}

function MyShifts({ userId }: { userId: string }) {
  const shifts = useMyShifts(userId);
  const settings = useCompanySettings();
  const { pending } = useClock();
  const now = useNow();

  const list = shifts.data ?? [];
  const current = currentShift(list, settings, pending, now);
  const others = list.filter((s) => s.id !== current?.id);
  const upcoming = others.filter((s) => Date.parse(s.endsAt) > now);
  const recent = others.filter((s) => Date.parse(s.endsAt) <= now).reverse();

  return (
    <ScrollView
      className="flex-1 bg-ink"
      contentContainerClassName="gap-4 p-5 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={shifts.isRefetching}
          onRefresh={() => void shifts.refetch()}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      <ClockQueueStatus shifts={list} settings={settings} />

      {shifts.isPending ? (
        <ActivityIndicator color={brand.gold} />
      ) : shifts.isError ? (
        <ErrorState
          message="Couldn't load your shifts."
          onRetry={() => void shifts.refetch()}
          error={shifts.error}
        />
      ) : list.length === 0 ? (
        <Card>
          <Text className="text-base text-white/80">
            You have no upcoming shifts. New shifts will show up here when your supervisor schedules
            them.
          </Text>
        </Card>
      ) : (
        <>
          {current ? (
            <Section title="Now">
              <ShiftCard shift={current} settings={settings} userId={userId} withClock />
            </Section>
          ) : null}

          {upcoming.length > 0 ? (
            <Section title="Upcoming">
              {upcoming.map((s) => (
                <ShiftCard key={s.id} shift={s} settings={settings} userId={userId} />
              ))}
            </Section>
          ) : !current ? (
            <Body>No upcoming shifts.</Body>
          ) : null}

          {recent.length > 0 ? (
            <Section title="Last 24 hours">
              {recent.map((s) => (
                <ShiftCard key={s.id} shift={s} settings={settings} userId={userId} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </View>
  );
}
