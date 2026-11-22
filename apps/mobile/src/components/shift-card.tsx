import {
  addDaysIso,
  formatDayShort,
  formatTimeRange,
  todayInZone,
  toZoned,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ClockPanel, useNow } from '@/components/clock-panel';
import { Badge, Button, Card, Notice } from '@/components/ui';
import {
  acceptedEvent,
  type CompanySettings,
  type MyShift,
  STATUS_LABELS,
  useAcknowledgeShift,
} from '@/lib/shifts';
import { brand } from '@/lib/theme';

/** "Today", "Tomorrow" or "Mon 5 Jan", in the company time zone. */
export function dayLabel(iso: string, timeZone: string, now: Date = new Date()): string {
  const day = toZoned(iso, timeZone).date;
  const today = todayInZone(timeZone, now);
  if (day === today) return 'Today';
  if (day === addDaysIso(today, 1)) return 'Tomorrow';
  if (day === addDaysIso(today, -1)) return 'Yesterday';
  return formatDayShort(day);
}

export function StatusBadge({ shift }: { shift: MyShift }) {
  const tone =
    shift.status === 'missed' || shift.status === 'cancelled'
      ? 'danger'
      : shift.status === 'scheduled' || shift.status === 'in_progress'
        ? 'gold'
        : 'muted';
  return <Badge tone={tone}>{STATUS_LABELS[shift.status]}</Badge>;
}

/** Acknowledge button for a scheduled shift that hasn't ended. */
export function AcknowledgeButton({ shift, userId }: { shift: MyShift; userId: string }) {
  const acknowledge = useAcknowledgeShift(userId);
  const now = useNow();
  if (shift.status !== 'scheduled' || Date.parse(shift.endsAt) <= now) return null;
  return (
    <View className="gap-2">
      <Button
        title="Acknowledge shift"
        variant="secondary"
        loading={acknowledge.isPending}
        onPress={() => acknowledge.mutate(shift.id)}
      />
      {acknowledge.isError ? (
        <Notice tone="error">
          Couldn&apos;t acknowledge: {acknowledge.error.message}. Check your connection and try
          again.
        </Notice>
      ) : null}
    </View>
  );
}

/** Opens the shift's daily activity report once the officer has clocked in. */
export function ReportButton({ shift }: { shift: MyShift }) {
  const now = useNow();
  const clockedIn = acceptedEvent(shift, 'clock_in') !== null;
  const open =
    shift.status === 'in_progress' ||
    (shift.status === 'completed' && now < Date.parse(shift.endsAt) + 12 * 60 * 60_000);
  if (!clockedIn || !open) return null;
  return (
    <Button
      title="Daily activity report"
      variant="secondary"
      onPress={() => router.push({ pathname: '/shifts/report/[id]', params: { id: shift.id } })}
    />
  );
}

export function ShiftCard({
  shift,
  settings,
  userId,
  withClock = false,
}: {
  shift: MyShift;
  settings: CompanySettings;
  userId: string;
  /** Show the Clock in / out button (the current shift). */
  withClock?: boolean;
}) {
  const tz = settings.timeZone;
  const cancelled = shift.status === 'cancelled';

  return (
    <Card tone={withClock ? 'warn' : 'default'}>
      <Pressable
        onPress={() => router.push({ pathname: '/shifts/[id]', params: { id: shift.id } })}
        accessibilityRole="button"
        accessibilityHint="Opens the shift details and site map"
        className="flex-row items-start gap-3 active:opacity-70"
      >
        <View className="flex-1 gap-1">
          <Text className="text-xs font-semibold uppercase tracking-wider text-gold">
            {dayLabel(shift.startsAt, tz)}
          </Text>
          <Text
            className={`text-xl font-bold ${cancelled ? 'text-white/50 line-through' : 'text-white'}`}
          >
            {formatTimeRange(shift.startsAt, shift.endsAt, tz)}
          </Text>
          <Text className="text-base text-white/85">{shift.site?.name ?? 'Site unavailable'}</Text>
          {shift.site?.address ? (
            <Text className="text-sm text-white/55" numberOfLines={1}>
              {shift.site.address}
            </Text>
          ) : null}
          <View className="mt-1">
            <StatusBadge shift={shift} />
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={brand.gold} />
      </Pressable>

      {withClock ? <ClockPanel shift={shift} settings={settings} userId={userId} /> : null}
      {withClock ? <ReportButton shift={shift} /> : null}
      <AcknowledgeButton shift={shift} userId={userId} />
    </Card>
  );
}
