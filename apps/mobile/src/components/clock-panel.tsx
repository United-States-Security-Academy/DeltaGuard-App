import {
  type AttendanceType,
  HANDOVER_NOTE_MAX,
  POST_ORDERS_REQUIRED_CODE,
  toZoned,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PostOrdersGate } from '@/components/post-orders';
import { Button, Card, Notice } from '@/components/ui';
import { clockActionFor, type SubmitOutcome, useClock } from '@/lib/clock';
import {
  type ClockMessage,
  describeEvent,
  describeQueued,
  describeRefusedQueued,
} from '@/lib/clock-messages';
import {
  checkLocationPermission,
  getClockFix,
  openAppSettings,
  requestLocationPermission,
} from '@/lib/location';
import { checkPostOrders, isAcknowledged, postOrderKeys } from '@/lib/post-orders';
import type { CompanySettings, MyShift } from '@/lib/shifts';
import { brand } from '@/lib/theme';

/** Re-render every 30 s so the button appears / changes as shift times pass. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const LABEL: Record<AttendanceType, string> = { clock_in: 'Clock in', clock_out: 'Clock out' };
const NOUN: Record<AttendanceType, string> = { clock_in: 'clock in', clock_out: 'clock out' };

type Step =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'post_orders' }
  | { kind: 'handover' }
  | { kind: 'explain'; type: AttendanceType }
  | { kind: 'locating'; type: AttendanceType }
  | { kind: 'sending'; type: AttendanceType }
  | { kind: 'problem'; message: string; settings?: boolean }
  | { kind: 'done'; message: ClockMessage };

/**
 * The Clock in / Clock out button for one shift, and what happens after a
 * tap: post orders to acknowledge (clock-in) or a handover note (clock-out),
 * explain + ask for location (first time only), take one GPS fix, send (or
 * queue offline), and show the result with any flags.
 */
export function ClockPanel({
  shift,
  settings,
  userId,
}: {
  shift: MyShift;
  settings: CompanySettings;
  userId: string;
}) {
  const { pending, submit } = useClock();
  const queryClient = useQueryClient();
  const now = useNow();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  // The handover note being written. Kept if the clock-out fails, so a retry
  // doesn't lose it; the ref is what the async steps read.
  const [note, setNote] = useState('');
  const noteRef = useRef('');
  const action = clockActionFor(shift, settings, pending, now);
  const siteName = shift.site?.name ?? 'the site';
  const queuedHere = pending.filter((q) => q.input.p_shift_id === shift.id);

  function editNote(value: string) {
    noteRef.current = value;
    setNote(value);
  }

  async function start(type: AttendanceType) {
    if (type === 'clock_out') {
      // Clocking out early is allowed but flagged: make sure it's intended.
      if (now < Date.parse(shift.endsAt) - 60_000) {
        const confirmed = await new Promise<boolean>((resolve) =>
          Alert.alert(
            'Clock out early?',
            `This shift ends at ${toZoned(shift.endsAt, settings.timeZone).time}. Clocking out now will be flagged as leaving early.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Clock out', style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          ),
        );
        if (!confirmed) return;
      }
      return setStep({ kind: 'handover' });
    }

    // Clock-in: the site's latest post orders must be acknowledged first.
    if (shift.site) {
      setStep({ kind: 'checking' });
      const check = await checkPostOrders(queryClient, shift.site.id, userId);
      if (check?.orders.some((o) => !isAcknowledged(o))) {
        if (check.fresh) return setStep({ kind: 'post_orders' });
        return setStep({
          kind: 'problem',
          message: `You haven’t acknowledged the latest post orders for ${siteName}, and you’re offline. Connect to the internet to read and acknowledge them, then clock in.`,
        });
      }
    }
    return withLocation(type);
  }

  async function withLocation(type: AttendanceType) {
    const permission = await checkLocationPermission();
    if (permission === 'granted') return locate(type);
    if (permission === 'ask') return setStep({ kind: 'explain', type });
    setStep({
      kind: 'problem',
      message: `Location access is turned off for DeltaGuard, so you can’t ${NOUN[type]}. In Settings, allow location “While using the app”${
        Platform.OS === 'ios' ? ' and turn on Precise Location' : ''
      }, then come back and try again.`,
      settings: true,
    });
  }

  async function afterExplain(type: AttendanceType) {
    setStep({ kind: 'locating', type });
    if ((await requestLocationPermission()) === 'granted') return locate(type);
    setStep({
      kind: 'problem',
      message: `Without location access you can’t ${NOUN[type]}: it’s how DeltaGuard confirms you’re at ${siteName}. If you change your mind, allow it in Settings.`,
      settings: true,
    });
  }

  async function locate(type: AttendanceType) {
    setStep({ kind: 'locating', type });
    const result = await getClockFix();
    if (!result.ok) {
      const message = {
        services_off:
          'Location services are turned off on this phone. Turn them on (in Settings or the quick settings panel) and try again.',
        permission:
          'Location access is turned off for DeltaGuard. Allow it in Settings and try again.',
        timeout:
          'Couldn’t get a GPS fix. Move outdoors or near a window, wait a few seconds, and try again.',
        unavailable:
          'Your phone couldn’t find its location. Check that location is on and try again.',
      }[result.reason];
      setStep({ kind: 'problem', message, settings: result.reason !== 'timeout' });
      return;
    }

    setStep({ kind: 'sending', type });
    const handoverNote = type === 'clock_out' ? noteRef.current.trim() : '';
    const outcome = await submit(shift.id, type, result.fix, handoverNote || undefined);

    // The server has newer post orders than this phone checked: show them.
    if (outcome.kind === 'error' && outcome.code === POST_ORDERS_REQUIRED_CODE && shift.site) {
      await queryClient.invalidateQueries({
        queryKey: postOrderKeys.site(shift.site.id, userId),
      });
      return setStep({ kind: 'post_orders' });
    }

    const message = toMessage(outcome, type);
    if (result.fix.reducedAccuracy && outcome.kind !== 'error') {
      message.lines.push(
        'Precise Location is off for DeltaGuard, so your position was approximate. Turn it on in Settings › DeltaGuard › Location.',
      );
    }
    if (handoverNote && outcome.kind !== 'error') {
      message.lines.push(
        outcome.kind === 'recorded'
          ? 'Your handover note was saved for the next officer at this site.'
          : 'Your handover note is saved with it and will be sent too.',
      );
      editNote('');
    }
    setStep({ kind: 'done', message });
  }

  function toMessage(outcome: SubmitOutcome, type: AttendanceType): ClockMessage {
    if (outcome.kind === 'recorded') return describeEvent(outcome.event, shift, settings.timeZone);
    if (outcome.kind === 'queued')
      return describeQueued(type, outcome.deviceTime, settings.timeZone);
    return {
      tone: 'error',
      title: `Couldn’t ${NOUN[type]}`,
      lines: [outcome.message],
    };
  }

  const busyType: AttendanceType | null =
    step.kind === 'checking'
      ? 'clock_in'
      : step.kind === 'locating' || step.kind === 'sending'
        ? step.type
        : null;
  const busy = busyType !== null;

  if (!action && step.kind === 'idle' && queuedHere.length === 0) return null;

  return (
    <View className="gap-3">
      {step.kind === 'done' ? (
        <MessageCard message={step.message} onDismiss={() => setStep({ kind: 'idle' })} />
      ) : null}

      {queuedHere.length > 0 && step.kind !== 'done' ? (
        <Notice tone="info">
          {queuedHere
            .map(
              (q) =>
                `Your ${q.input.p_type === 'clock_in' ? 'clock-in' : 'clock-out'} at ${
                  toZoned(q.input.p_device_time!, settings.timeZone).time
                }`,
            )
            .join(' and ')}{' '}
          {queuedHere.length > 1 ? 'are' : 'is'} saved on this phone and will be sent when
          you&apos;re back online.
        </Notice>
      ) : null}

      {step.kind === 'problem' ? (
        <View className="gap-2">
          <Notice tone="error">{step.message}</Notice>
          {step.settings ? (
            <Button title="Open Settings" variant="secondary" onPress={openAppSettings} />
          ) : null}
        </View>
      ) : null}

      {action || busyType ? (
        <View className="gap-2">
          <Button
            title={LABEL[busyType ?? action!]}
            variant={(busyType ?? action) === 'clock_out' ? 'secondary' : 'primary'}
            loading={busy}
            onPress={() => void start(action!)}
          />
          <Text className="text-center text-xs leading-4 text-white/50">
            {step.kind === 'checking'
              ? 'Checking the post orders for this site…'
              : step.kind === 'locating'
                ? 'Getting a GPS fix… This can take a few seconds, especially indoors.'
                : step.kind === 'sending'
                  ? 'Sending…'
                  : `Uses your location once, now, to confirm you’re at ${siteName}.`}
          </Text>
        </View>
      ) : null}

      {shift.site ? (
        <PostOrdersGate
          visible={step.kind === 'post_orders'}
          siteId={shift.site.id}
          siteName={siteName}
          userId={userId}
          timeZone={settings.timeZone}
          onDone={() => void withLocation('clock_in')}
          onCancel={() => setStep({ kind: 'idle' })}
        />
      ) : null}

      <HandoverNote
        visible={step.kind === 'handover'}
        siteName={siteName}
        value={note}
        onChange={editNote}
        onSubmit={() => void withLocation('clock_out')}
        onCancel={() => setStep({ kind: 'idle' })}
      />

      <ExplainLocation
        visible={step.kind === 'explain'}
        type={step.kind === 'explain' ? step.type : 'clock_in'}
        siteName={siteName}
        onContinue={() => step.kind === 'explain' && void afterExplain(step.type)}
        onCancel={() => setStep({ kind: 'idle' })}
      />
    </View>
  );
}

/** Asked at clock-out: a note the next officer at the site will see. */
function HandoverNote({
  visible,
  siteName,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  siteName: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const hasNote = value.trim() !== '';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center bg-black/70 px-6"
      >
        <View className="gap-4 rounded-2xl border border-gold/30 bg-navy p-5">
          <View className="flex-row items-start gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-gold/15">
              <Ionicons name="swap-horizontal" size={24} color={brand.gold} />
            </View>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel clock-out"
              hitSlop={10}
              className="ml-auto"
            >
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
          <Text className="text-xl font-bold text-white">Handover note</Text>
          <Text className="text-base leading-6 text-white/80">
            Anything the next officer at {siteName} should know? Faults, open issues, keys, visitors
            still on site…
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            multiline
            maxLength={HANDOVER_NOTE_MAX}
            placeholder="e.g. Gate 2 lock is faulty, maintenance called. Keys with reception."
            placeholderTextColor="rgba(255,255,255,0.4)"
            selectionColor={brand.gold}
            keyboardAppearance="dark"
            accessibilityLabel="Handover note"
            textAlignVertical="top"
            className="min-h-28 rounded-2xl border border-white/10 bg-ink px-4 py-3 text-base text-white"
          />
          <Button
            title={hasNote ? 'Save note and clock out' : 'Clock out without a note'}
            variant={hasNote ? 'primary' : 'secondary'}
            onPress={onSubmit}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Shown before the OS location prompt, the first time only. */
function ExplainLocation({
  visible,
  type,
  siteName,
  onContinue,
  onCancel,
}: {
  visible: boolean;
  type: AttendanceType;
  siteName: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 justify-center bg-black/70 px-6">
        <View className="gap-4 rounded-2xl border border-gold/30 bg-navy p-5">
          <View className="h-12 w-12 items-center justify-center rounded-xl bg-gold/15">
            <Ionicons name="location" size={24} color={brand.gold} />
          </View>
          <Text className="text-xl font-bold text-white">
            Your location is needed to {NOUN[type]}
          </Text>
          <View className="gap-2">
            <Text className="text-base leading-6 text-white/80">
              To confirm you&apos;re at {siteName}, DeltaGuard checks your phone&apos;s location
              once, at the moment you {NOUN[type]}.
            </Text>
            <Text className="text-base leading-6 text-white/80">
              It is only used when you clock in, clock out or send an SOS. It is never tracked in
              the background.
            </Text>
            <Text className="text-base leading-6 text-white/80">
              Your phone will now ask for permission. Choose{' '}
              <Text className="font-semibold text-white">
                {Platform.OS === 'ios' ? '“Allow While Using App”' : '“While using the app”'}
              </Text>
              {Platform.OS === 'ios' ? ' and keep Precise Location on.' : ' and “Precise”.'}
            </Text>
          </View>
          <Button title="Continue" onPress={onContinue} />
          <Button title="Not now" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

export function MessageCard({
  message,
  onDismiss,
}: {
  message: ClockMessage;
  onDismiss?: () => void;
}) {
  const icon = {
    success: 'checkmark-circle',
    warn: 'warning',
    error: 'close-circle',
  } as const;
  const colour = { success: brand.gold, warn: brand.gold, error: '#fca5a5' }[message.tone];
  return (
    <Card tone={message.tone === 'error' ? 'danger' : message.tone === 'warn' ? 'warn' : 'default'}>
      <View className="flex-row items-start gap-3" accessibilityRole="alert">
        <Ionicons name={icon[message.tone]} size={24} color={colour} />
        <View className="flex-1 gap-1.5">
          <Text className="text-lg font-bold text-white">{message.title}</Text>
          {message.lines.map((line) => (
            <Text key={line} className="text-sm leading-5 text-white/85">
              {line}
            </Text>
          ))}
        </View>
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={10}
          >
            <Ionicons name="close" size={20} color="rgba(255,255,255,0.6)" />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * App-wide: events waiting to be sent, and the outcome of ones that were
 * sent after the phone came back online.
 */
export function ClockQueueStatus({
  shifts,
  settings,
}: {
  shifts: readonly MyShift[];
  settings: CompanySettings;
}) {
  const { pending, reports, dismissReport, flush, flushing } = useClock();
  if (pending.length === 0 && reports.length === 0) return null;

  return (
    <View className="gap-3">
      {reports.map((r) => {
        const shift = shifts.find((s) => s.id === r.item.input.p_shift_id) ?? null;
        const type = r.item.input.p_type;
        const message: ClockMessage =
          r.outcome === 'sent'
            ? describeEvent(r.event, shift, settings.timeZone)
            : r.outcome === 'duplicate'
              ? {
                  tone: 'success',
                  title: `Your ${type === 'clock_in' ? 'clock-in' : 'clock-out'} was already recorded`,
                  lines: [],
                }
              : describeRefusedQueued(
                  type,
                  r.item.input.p_device_time,
                  r.message,
                  settings.timeZone,
                );
        return <MessageCard key={r.id} message={message} onDismiss={() => dismissReport(r.id)} />;
      })}

      {pending.length > 0 ? (
        <Card tone="warn">
          <View className="flex-row items-start gap-3">
            <Ionicons name="cloud-offline-outline" size={22} color={brand.gold} />
            <View className="flex-1 gap-1">
              <Text className="text-base font-bold text-white">
                {pending.length === 1
                  ? '1 clock event waiting to send'
                  : `${pending.length} clock events waiting to send`}
              </Text>
              <Text className="text-sm leading-5 text-white/75">
                Saved on this phone with the time and place. It will be sent automatically when
                you&apos;re back online, marked as delayed.
              </Text>
            </View>
          </View>
          <Button
            title="Try sending now"
            variant="secondary"
            loading={flushing}
            onPress={() => void flush()}
          />
        </Card>
      ) : null}
    </View>
  );
}
