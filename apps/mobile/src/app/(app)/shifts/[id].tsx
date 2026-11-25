import { attendanceFlagLabel, formatTimeRange, toZoned } from '@deltaguard/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';

import { ClockPanel, ClockQueueStatus } from '@/components/clock-panel';
import { HandoverCard } from '@/components/handover';
import { PostOrdersSection } from '@/components/post-orders';
import { AcknowledgeButton, dayLabel, ReportButton, StatusBadge } from '@/components/shift-card';
import { EmergencyInstructions, SiteContacts } from '@/components/site-info';
import { SiteMap } from '@/components/site-map';
import { Badge, Body, Button, Card, ErrorState, InfoRow, Notice, Title } from '@/components/ui';
import { formatDistance } from '@/lib/clock-messages';
import { openDirections } from '@/lib/directions';
import { useSession } from '@/lib/session';
import {
  acceptedEvent,
  type CompanySettings,
  type MyShift,
  type ShiftAttendance,
  useCompanySettings,
  useMyShifts,
} from '@/lib/shifts';
import { brand } from '@/lib/theme';

export default function ShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <ShiftDetail id={id} userId={state.profile.id} />;
}

function ShiftDetail({ id, userId }: { id: string; userId: string }) {
  // The list query already holds every shift this screen can open.
  const shifts = useMyShifts(userId);
  const settings = useCompanySettings();
  const shift = shifts.data?.find((s) => s.id === id);

  if (shifts.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
        <ActivityIndicator color={brand.gold} />
      </View>
    );
  }
  if (shifts.isError) {
    return (
      <View className="flex-1 bg-ink p-5">
        <ErrorState
          message="Couldn't load this shift."
          onRetry={() => void shifts.refetch()}
          error={shifts.error}
        />
      </View>
    );
  }
  if (!shift) {
    return (
      <View className="flex-1 bg-ink p-5">
        <Notice tone="info">
          This shift is no longer in your schedule. It may have been removed, or it ended more than
          a day ago.
        </Notice>
      </View>
    );
  }

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
      <View className="gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wider text-gold">
          {dayLabel(shift.startsAt, settings.timeZone)}
        </Text>
        <Title>{formatTimeRange(shift.startsAt, shift.endsAt, settings.timeZone)}</Title>
        <View className="mt-1">
          <StatusBadge shift={shift} />
        </View>
      </View>

      {shift.status === 'cancelled' ? (
        <Notice tone="error">This shift was cancelled. You don&apos;t need to attend.</Notice>
      ) : null}

      <ClockQueueStatus shifts={shifts.data ?? []} settings={settings} />
      <HandoverCard shift={shift} timeZone={settings.timeZone} />
      <ClockPanel shift={shift} settings={settings} userId={userId} />
      <ReportButton shift={shift} />
      <AcknowledgeButton shift={shift} userId={userId} />

      <Attendance shift={shift} settings={settings} />

      {shift.notes ? (
        <Card>
          <InfoRow label="Notes from your supervisor" value={shift.notes} />
        </Card>
      ) : null}

      {shift.site && shift.status !== 'cancelled' ? (
        <PostOrdersSection siteId={shift.site.id} userId={userId} timeZone={settings.timeZone} />
      ) : null}

      <SiteSection shift={shift} />
    </ScrollView>
  );
}

function Attendance({ shift, settings }: { shift: MyShift; settings: CompanySettings }) {
  const clockIn = acceptedEvent(shift, 'clock_in');
  const clockOut = acceptedEvent(shift, 'clock_out');
  const refused = shift.attendance.filter((e) => !e.accepted);
  if (!clockIn && !clockOut && refused.length === 0) return null;

  return (
    <Card>
      {clockIn ? <EventRow label="Clocked in" event={clockIn} settings={settings} /> : null}
      {clockOut ? <EventRow label="Clocked out" event={clockOut} settings={settings} /> : null}
      {refused.length > 0 ? (
        <Notice tone="error">
          {refused.length === 1 ? 'One attempt' : `${refused.length} attempts`} from a phone that
          isn&apos;t your registered device {refused.length === 1 ? 'was' : 'were'} refused.
        </Notice>
      ) : null}
    </Card>
  );
}

function EventRow({
  label,
  event,
  settings,
}: {
  label: string;
  event: ShiftAttendance;
  settings: CompanySettings;
}) {
  const delayed = event.flags.includes('delayed');
  const at = delayed && event.deviceTime ? event.deviceTime : event.recordedAt;
  return (
    <View className="gap-1.5">
      <InfoRow
        label={label}
        value={`${toZoned(at, settings.timeZone).time}${
          event.distanceM !== null ? ` · ${formatDistance(Number(event.distanceM))} from site` : ''
        }`}
      />
      {event.flags.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {event.flags.map((f) => (
            <Badge key={f} tone={f === 'delayed' ? 'muted' : 'gold'}>
              {attendanceFlagLabel(f)}
            </Badge>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SiteSection({ shift }: { shift: MyShift }) {
  const [directionsError, setDirectionsError] = useState<string | null>(null);
  const site = shift.site;
  if (!site) {
    return (
      <Card>
        <Body>
          You&apos;re no longer assigned to this shift&apos;s site, so its details are hidden. Ask
          your supervisor.
        </Body>
      </Card>
    );
  }

  const hasPin = site.latitude !== null && site.longitude !== null;
  const canNavigate = hasPin || Boolean(site.address);
  const directions = async () => {
    setDirectionsError(null);
    if (!(await openDirections(site)))
      setDirectionsError('No maps app could open these directions.');
  };

  return (
    <Card>
      <View className="gap-1">
        <Text className="text-lg font-bold text-white">{site.name}</Text>
        <Text className="text-sm leading-5 text-white/70">
          {site.address ?? 'No address recorded'}
        </Text>
      </View>

      {hasPin ? (
        <View className="gap-1.5">
          <SiteMap
            latitude={site.latitude!}
            longitude={site.longitude!}
            radiusM={site.radiusM}
            label={site.name}
            onPress={() => void directions()}
          />
          <Text className="text-xs text-white/50">
            Clock in within the gold circle ({formatDistance(site.radiusM)} of the site).
          </Text>
        </View>
      ) : (
        <Text className="text-sm text-white/50">
          No map: this site&apos;s location isn&apos;t set.
        </Text>
      )}

      {canNavigate ? <Button title="Get directions" onPress={() => void directions()} /> : null}
      {directionsError ? <Notice tone="error">{directionsError}</Notice> : null}

      <EmergencyInstructions text={site.emergencyInstructions} />
      <SiteContacts contacts={site.contacts} />
    </Card>
  );
}
