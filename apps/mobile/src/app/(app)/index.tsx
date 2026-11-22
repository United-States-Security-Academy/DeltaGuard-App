import { COMPANY_NAME } from '@deltaguard/shared';
import { ScrollView, View } from 'react-native';

import { ClockQueueStatus, useNow } from '@/components/clock-panel';
import { HandoverCard } from '@/components/handover';
import { ShiftCard } from '@/components/shift-card';
import { Body, Eyebrow, SectionTitle, Title } from '@/components/ui';
import { currentShift, useClock } from '@/lib/clock';
import { useSession } from '@/lib/session';
import { useCompanySettings, useMyShifts } from '@/lib/shifts';
import { canSeeTab } from '@/lib/tabs';

export default function HomeScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  const { profile } = state;

  return (
    <ScrollView className="flex-1 bg-ink" contentContainerClassName="gap-4 p-6">
      <View className="gap-2">
        <Eyebrow>{COMPANY_NAME}</Eyebrow>
        <Title>{profile.fullName ? `Welcome, ${profile.fullName}` : 'Welcome'}</Title>
      </View>
      {canSeeTab('shifts', profile.role) ? (
        <ShiftNow userId={profile.id} />
      ) : (
        <Body>Your alerts are in the inbox: tap the bell at the top right.</Body>
      )}
    </ScrollView>
  );
}

/** The shift to clock in to / out of right now, or the next one. */
function ShiftNow({ userId }: { userId: string }) {
  const shifts = useMyShifts(userId);
  const settings = useCompanySettings();
  const { pending } = useClock();
  const now = useNow();
  const list = shifts.data ?? [];
  const current = currentShift(list, settings, pending, now);
  const next = current
    ? null
    : list.find((s) => Date.parse(s.startsAt) > now && s.status !== 'cancelled');

  return (
    <View className="gap-3">
      <ClockQueueStatus shifts={list} settings={settings} />
      {current ? (
        <>
          <SectionTitle>Current shift</SectionTitle>
          <HandoverCard shift={current} timeZone={settings.timeZone} />
          <ShiftCard shift={current} settings={settings} userId={userId} withClock />
        </>
      ) : next ? (
        <>
          <SectionTitle>Next shift</SectionTitle>
          <ShiftCard shift={next} settings={settings} userId={userId} />
        </>
      ) : shifts.isSuccess ? (
        <Body>You have no upcoming shifts.</Body>
      ) : null}
    </View>
  );
}
