import { COMPANY_NAME, formatTimeRange, type UserRole, toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ClockQueueStatus, useNow } from '@/components/clock-panel';
import { HandoverCard } from '@/components/handover';
import { dayLabel, ShiftCard } from '@/components/shift-card';
import { Body, Eyebrow, IconRing, SectionTitle, Title } from '@/components/ui';
import { clockActionFor, currentShift, useClock } from '@/lib/clock';
import { useFormSync } from '@/lib/form-sync';
import { buildLists, useMyForms } from '@/lib/forms';
import { useUnreadMessageTotal } from '@/lib/messaging';
import { lessonState, useMyTraining } from '@/lib/training';
import { useTrainingSync } from '@/lib/training-sync';
import { useUnreadCount } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { acceptedEvent, type MyShift, useCompanySettings, useMyShifts } from '@/lib/shifts';
import { canSeeTab } from '@/lib/tabs';
import { brand, fx } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function HomeScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  const { profile } = state;
  const firstName = profile.fullName?.trim().split(/\s+/)[0];

  return (
    <ScrollView
      className="flex-1"
      style={fx.screen}
      contentContainerClassName="gap-5 px-5 pb-36 pt-4"
    >
      <View className="gap-1.5">
        <Eyebrow>{COMPANY_NAME}</Eyebrow>
        <Title>
          <Greeting />
          {firstName ? `, ${firstName}` : ''}
        </Title>
      </View>

      {canSeeTab('shifts', profile.role) ? <ShiftNow userId={profile.id} /> : null}

      <SectionTitle>Quick access</SectionTitle>
      <QuickTiles userId={profile.id} role={profile.role} />
    </ScrollView>
  );
}

/** "Good morning" / "Good afternoon" / "Good evening" in the company time zone. */
function Greeting() {
  const { timeZone } = useCompanySettings();
  const now = useNow(60_000);
  const hour = Number(toZoned(new Date(now), timeZone).time.slice(0, 2));
  return <>{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</>;
}

/** Status strip, then the shift to clock in to / out of now, or the next one. */
function ShiftNow({ userId }: { userId: string }) {
  const shifts = useMyShifts(userId);
  const settings = useCompanySettings();
  const { pending } = useClock();
  const now = useNow();
  const list = shifts.data ?? [];
  const current = currentShift(list, settings, pending, now);
  const next = current
    ? null
    : (list.find((s) => Date.parse(s.startsAt) > now && s.status !== 'cancelled') ?? null);
  const onDuty =
    current !== null &&
    (clockActionFor(current, settings, pending, now) === 'clock_out' ||
      (acceptedEvent(current, 'clock_in') !== null &&
        acceptedEvent(current, 'clock_out') === null));

  return (
    <View className="gap-4">
      {shifts.isSuccess ? (
        <StatusStrip current={current} next={next} onDuty={onDuty} timeZone={settings.timeZone} />
      ) : null}
      {onDuty ? <DutyScreenCard /> : null}
      <ClockQueueStatus shifts={list} settings={settings} />
      {current ? (
        <>
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

/** "STATUS · ON DUTY at Site" (or ready / off duty), like a device status bar. */
function StatusStrip({
  current,
  next,
  onDuty,
  timeZone,
}: {
  current: MyShift | null;
  next: MyShift | null;
  onDuty: boolean;
  timeZone: string;
}) {
  const shift = current ?? next;
  const [state, detail] = onDuty
    ? ['ON DUTY', current?.site?.name ? `at ${current.site.name}` : '']
    : current
      ? ['READY TO CLOCK IN', current.site?.name ? `at ${current.site.name}` : '']
      : [
          'OFF DUTY',
          next
            ? `Next: ${dayLabel(next.startsAt, timeZone)} ${formatTimeRange(next.startsAt, next.endsAt, timeZone)}`
            : 'No upcoming shifts',
        ];
  const lit = onDuty || current !== null;

  return (
    <Pressable
      disabled={!shift}
      onPress={() => shift && router.push({ pathname: '/shifts/[id]', params: { id: shift.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Status: ${state.toLowerCase()} ${detail}`}
      className="flex-row items-center gap-4 rounded-3xl border border-white/[0.06] py-3 pl-3 pr-5 active:opacity-80"
      style={fx.glass}
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={
          lit
            ? fx.gold
            : {
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
              }
        }
      >
        <Ionicons
          name={onDuty ? 'shield-checkmark' : current ? 'time' : 'moon'}
          size={19}
          color={lit ? brand.ink : 'rgba(255,255,255,0.6)'}
        />
      </View>
      <View className="flex-1">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-white/50">Status</Text>
        <Text className="text-base font-extrabold text-white" numberOfLines={1}>
          <Text className={lit ? 'text-gold' : 'text-white/80'}>{state}</Text>
          {detail ? (
            <Text className="text-sm font-semibold text-white/70">{`  ${detail}`}</Text>
          ) : null}
        </Text>
      </View>
      {shift ? <Ionicons name="chevron-forward" size={18} color={brand.gold} /> : null}
    </Pressable>
  );
}

type TileSpec = { key: string; label: string; icon: IconName; href: Href; badge?: number };

/** The app's sections as a grid of tiles. */
function QuickTiles({ userId, role }: { userId: string; role: UserRole }) {
  const unreadMessages = useUnreadMessageTotal(userId);
  const unreadAlerts = useUnreadCount(userId);
  const forms = useMyForms(userId);
  const { items: localForms } = useFormSync();
  const formLists = buildLists(forms.data, localForms);
  const formsToDo = formLists.todo.length + formLists.returned.length;
  const training = useMyTraining(userId);
  const { state: trainingLocal } = useTrainingSync();
  const trainingToDo = (training.data ?? []).filter(
    (l) => !lessonState(l, trainingLocal).done,
  ).length;

  const all: (TileSpec & { tab?: Parameters<typeof canSeeTab>[0] })[] = [
    { key: 'shifts', tab: 'shifts', label: 'Shifts', icon: 'calendar-outline', href: '/shifts' },
    { key: 'sites', tab: 'sites', label: 'Sites', icon: 'location-outline', href: '/sites' },
    {
      key: 'reports',
      tab: 'reports',
      label: 'Reports',
      icon: 'document-text-outline',
      href: '/reports',
    },
    {
      key: 'messages',
      tab: 'messages',
      label: 'Messages',
      icon: 'chatbubbles-outline',
      href: '/messages',
      badge: unreadMessages,
    },
    {
      key: 'forms',
      label: 'Forms',
      icon: 'clipboard-outline',
      href: '/forms',
      badge: formsToDo,
    },
    {
      key: 'training',
      label: 'Training',
      icon: 'school-outline',
      href: '/training',
      badge: trainingToDo,
    },
    {
      key: 'alerts',
      label: 'Alerts',
      icon: 'notifications-outline',
      href: '/notifications',
      badge: unreadAlerts,
    },
    {
      key: 'profile',
      tab: 'profile',
      label: 'Profile',
      icon: 'person-circle-outline',
      href: '/profile',
    },
  ];
  const tiles = all.filter((t) => !t.tab || canSeeTab(t.tab, role));
  const rows: TileSpec[][] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));

  return (
    <View className="gap-4">
      {rows.map((row) => (
        <View key={row.map((t) => t.key).join()} className="flex-row gap-4">
          {row.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}

function Tile({ tile }: { tile: TileSpec }) {
  const badge = tile.badge ?? 0;
  return (
    <Pressable
      // Tabs switch in place; the inbox and forms are pushed on top of the tabs.
      onPress={() =>
        tile.key === 'alerts' || tile.key === 'forms' || tile.key === 'training'
          ? router.push(tile.href)
          : router.navigate(tile.href)
      }
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${tile.label}, ${badge} unread` : tile.label}
      className="flex-1 items-center justify-center gap-3 rounded-3xl border border-white/[0.06] py-5 active:opacity-80"
      style={fx.glass}
    >
      <IconRing name={tile.icon} size={48} />
      <Text className="text-xs font-extrabold uppercase tracking-[2px] text-white">
        {tile.label}
      </Text>
      {badge > 0 ? (
        <View className="absolute right-4 top-4 min-w-6 items-center rounded-full bg-gold px-1.5 py-0.5">
          <Text className="text-[11px] font-bold text-ink">{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** While on duty: back to the dimmed duty screen. */
function DutyScreenCard() {
  return (
    <Pressable
      onPress={() => router.push('/on-duty')}
      accessibilityRole="button"
      className="flex-row items-center gap-4 rounded-3xl border border-gold/40 p-4 active:opacity-80"
      style={fx.glass}
    >
      <Ionicons name="moon-outline" size={22} color={brand.gold} />
      <View className="flex-1">
        <Text className="text-base font-bold text-white">On-duty screen</Text>
        <Text className="text-xs text-white/60">
          Dimmed to save battery. Welfare checks appear here.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={brand.gold} />
    </Pressable>
  );
}
