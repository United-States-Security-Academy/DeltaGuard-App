import {
  friendlyError,
  INCIDENT_CATEGORIES,
  INCIDENT_MAX_PHOTOS,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  incidentCategoryLabel,
  todayInZone,
  toZoned,
  type IncidentSeverity,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';

import { SyncLine } from '@/components/incident-status';
import { Body, Button, Card, Input, Notice, SectionTitle } from '@/components/ui';
import {
  type FormErrors,
  matchingShift,
  occurredAtMs,
  shiftToLink,
  toPayload,
} from '@/lib/incident-form';
import { choosePhotos, deleteLocalPhoto, preparePhoto, takePhoto } from '@/lib/incident-photos';
import {
  deleteReportFiles,
  type IncidentFormState,
  type LocalIncident,
} from '@/lib/incident-store';
import { useIncidentSync } from '@/lib/incident-sync';
import { useMySites } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useCompanySettings, useMyShifts } from '@/lib/shifts';
import { brand } from '@/lib/theme';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  const { items, loaded } = useIncidentSync();
  // Set once this screen queues the report, to say "sent" when it leaves the phone.
  const [submitted, setSubmitted] = useState(false);
  if (state.status !== 'ready') return null;
  const item = items.find((i) => i.id === id);

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
        <ActivityIndicator color={brand.gold} />
      </View>
    );
  }
  if (!item) {
    return (
      <View className="flex-1 gap-4 bg-ink p-5">
        {submitted ? (
          <Notice tone="info">Report sent. Your supervisor will review it.</Notice>
        ) : (
          <Notice tone="info">
            This report is no longer on this phone: it has been sent, or the draft was deleted.
          </Notice>
        )}
        <Button title="Back to reports" onPress={() => router.back()} />
      </View>
    );
  }
  if (item.state === 'queued') return <QueuedView item={item} />;
  return (
    <DraftForm
      key={item.id}
      item={item}
      userId={state.profile.id}
      onQueued={() => setSubmitted(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Submitted, waiting to be sent
// ---------------------------------------------------------------------------

function QueuedView({ item }: { item: LocalIncident }) {
  const settings = useCompanySettings();
  const { syncNow, sendingId } = useIncidentSync();
  return (
    <ScrollView className="flex-1 bg-ink" contentContainerClassName="gap-4 p-5">
      <Card tone="warn">
        <Text className="text-lg font-bold text-white">Submitted</Text>
        <SyncLine item={item} timeZone={settings.timeZone} />
        <Body>
          The report and its photos are saved on this phone. They are sent in the background, even
          if you leave this screen, and retried until they get through.
        </Body>
        {sendingId !== item.id ? (
          <Button title="Try sending now" variant="secondary" onPress={() => void syncNow()} />
        ) : null}
      </Card>
      <Summary item={item} />
    </ScrollView>
  );
}

function Summary({ item }: { item: LocalIncident }) {
  const f = item.form;
  return (
    <Card>
      <Text className="text-base font-bold text-white">
        {f.category ? incidentCategoryLabel(f.category) : 'Incident'} ·{' '}
        {f.severity ? INCIDENT_SEVERITY_LABELS[f.severity] : ''}
      </Text>
      <Text className="text-sm text-white/60">
        {f.date} {f.time}
      </Text>
      <Text className="text-base leading-6 text-white/85">{f.description}</Text>
      {f.peopleInvolved ? (
        <Text className="text-sm leading-5 text-white/70">People: {f.peopleInvolved}</Text>
      ) : null}
      <Text className="text-sm text-white/70">Police called: {f.policeCalled ? 'Yes' : 'No'}</Text>
      {item.photos.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {item.photos.map((p) => (
            <Image
              key={p.id}
              source={{ uri: p.localUri }}
              style={{ width: 72, height: 72, borderRadius: 8 }}
              contentFit="cover"
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

const AUTOSAVE_MS = 600;

function DraftForm({
  item,
  userId,
  onQueued,
}: {
  item: LocalIncident;
  userId: string;
  onQueued: () => void;
}) {
  const settings = useCompanySettings();
  const tz = settings.timeZone;
  const { save, syncNow } = useIncidentSync();
  const sites = useMySites(userId);
  const shifts = useMyShifts(userId);
  const [form, setForm] = useState<IncidentFormState>(item.form);
  const [errors, setErrors] = useState<FormErrors>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busyPhotos, setBusyPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef(form);
  const dirty = useRef(false);

  // Autosave ---------------------------------------------------------------
  async function flush() {
    if (!dirty.current) return;
    dirty.current = false;
    const next = latest.current;
    await save(item.id, (current) =>
      current
        ? {
            ...current,
            form: next,
            // Editing a refused report makes it a draft again.
            state: current.state === 'failed' ? 'draft' : current.state,
            updatedAt: Date.now(),
          }
        : null,
    );
    setSavedAt(Date.now());
  }
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [form]);

  // Also save when leaving the screen or the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void flushRef.current();
    });
    return () => {
      sub.remove();
      void flushRef.current();
    };
  }, []);

  function update(patch: Partial<IncidentFormState>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    dirty.current = true;
    setForm(next);
    setErrors((e) => {
      const copy = { ...e };
      for (const key of Object.keys(patch)) delete copy[key as keyof FormErrors];
      return copy;
    });
  }

  // Photos -------------------------------------------------------------------
  const room = INCIDENT_MAX_PHOTOS - item.existingPhotoCount - item.photos.length;

  async function addPhotos(source: 'camera' | 'library') {
    setPhotoError(null);
    const result = source === 'camera' ? await takePhoto() : await choosePhotos(room);
    if (result.kind === 'denied') return setPhotoError(result.message);
    if (result.kind === 'cancelled') return;
    setBusyPhotos(true);
    try {
      for (const uri of result.uris.slice(0, room)) {
        const photo = await preparePhoto(userId, item.id, uri);
        await save(item.id, (current) =>
          current
            ? { ...current, photos: [...current.photos, photo], updatedAt: Date.now() }
            : null,
        );
      }
    } catch (e) {
      setPhotoError(friendlyError(e, { action: 'add the photo' }));
    } finally {
      setBusyPhotos(false);
    }
  }

  async function removePhoto(photoId: string) {
    const photo = item.photos.find((p) => p.id === photoId);
    await save(item.id, (current) =>
      current ? { ...current, photos: current.photos.filter((p) => p.id !== photoId) } : null,
    );
    // An uploaded file stays in storage but won't be part of the report.
    if (photo) deleteLocalPhoto(photo);
  }

  // Submit / delete --------------------------------------------------------------
  async function submit() {
    const draft: LocalIncident = { ...item, form: latest.current };
    const shiftId = shiftToLink(draft, shifts.data ?? [], tz);
    const result = toPayload({ ...draft, form: { ...draft.form, shiftId } }, tz);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSubmitting(true);
    dirty.current = false;
    onQueued();
    await save(item.id, (current) =>
      current
        ? {
            ...current,
            form: { ...latest.current, shiftId },
            state: 'queued',
            payload: result.payload,
            attempts: 0,
            nextAttemptAt: null,
            lastError: null,
            queuedAt: Date.now(),
            updatedAt: Date.now(),
          }
        : null,
    );
    void syncNow();
  }

  function remove() {
    Alert.alert(
      item.mode === 'resubmit' ? 'Discard your changes?' : 'Delete this draft?',
      item.mode === 'resubmit'
        ? 'The report stays returned on the server; only the changes on this phone are discarded.'
        : 'The draft and its photos are deleted from this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: item.mode === 'resubmit' ? 'Discard' : 'Delete',
          style: 'destructive',
          onPress: () => {
            dirty.current = false;
            void save(item.id, () => null).then(() => {
              deleteReportFiles(userId, item.id);
              router.back();
            });
          },
        },
      ],
    );
  }

  const at = occurredAtMs(form, tz);
  const linkedShift = matchingShift(shifts.data ?? [], form.siteId, at);
  const siteOptions = [...(sites.data ?? [])];
  if (form.siteId && !siteOptions.some((s) => s.id === form.siteId)) {
    siteOptions.push({
      id: form.siteId,
      name: 'Current site (no longer assigned)',
      address: null,
      latitude: null,
      longitude: null,
      emergencyInstructions: null,
      contacts: [],
    });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-ink"
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerClassName="gap-5 p-5 pb-16" keyboardShouldPersistTaps="handled">
        {item.state === 'failed' ? (
          <Notice tone="error">
            The server didn&apos;t accept this report: {item.lastError}. Correct it and submit
            again.
          </Notice>
        ) : null}
        {item.mode === 'resubmit' && item.reviewNotes ? (
          <Card tone="warn">
            <Text className="text-base font-bold text-white">Returned by your supervisor</Text>
            <Text className="text-base leading-6 text-white/85">{item.reviewNotes}</Text>
          </Card>
        ) : null}

        <Field label="Site" error={errors.siteId}>
          {siteOptions.length === 0 ? (
            <Body>You aren&apos;t assigned to any site. Ask your supervisor.</Body>
          ) : (
            <Chips
              options={siteOptions.map((s) => ({ value: s.id, label: s.name }))}
              value={form.siteId}
              onChange={(siteId) => update({ siteId })}
            />
          )}
        </Field>

        <Field label="When did it happen?" error={errors.time ?? errors.date}>
          <View className="flex-row items-end gap-2">
            <View className="flex-1">
              <Input
                label="Date"
                value={form.date}
                onChangeText={(date) => update({ date })}
                placeholder="YYYY-MM-DD"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
            <View className="w-28">
              <Input
                label="Time"
                value={form.time}
                onChangeText={(time) => update({ time })}
                placeholder="HH:MM"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
            <Pressable
              onPress={() => update({ date: todayInZone(tz), time: toZoned(new Date(), tz).time })}
              accessibilityRole="button"
              className="mb-1 h-14 justify-center rounded-2xl border border-white/15 bg-navy px-4 active:opacity-70"
            >
              <Text className="font-semibold text-white">Now</Text>
            </Pressable>
          </View>
          {linkedShift ? (
            <Text className="text-xs text-white/50">
              Linked to your shift {toZoned(linkedShift.startsAt, tz).time}–
              {toZoned(linkedShift.endsAt, tz).time}.
            </Text>
          ) : null}
        </Field>

        <Field label="Category" error={errors.category}>
          <Chips
            options={INCIDENT_CATEGORIES.map((c) => ({
              value: c,
              label: incidentCategoryLabel(c),
            }))}
            value={form.category}
            onChange={(category) => update({ category })}
          />
        </Field>

        <Field label="Severity" error={errors.severity}>
          <Chips
            options={INCIDENT_SEVERITIES.map((s) => ({
              value: s,
              label: INCIDENT_SEVERITY_LABELS[s],
            }))}
            value={form.severity}
            onChange={(severity: IncidentSeverity) => update({ severity })}
            danger={['high', 'critical']}
          />
          {form.severity === 'critical' ? (
            <Text className="text-xs leading-4 text-red-200">
              For an emergency, call your supervisor or emergency services first. Write the report
              when it is safe.
            </Text>
          ) : null}
        </Field>

        <Input
          label="What happened?"
          value={form.description}
          onChangeText={(description) => update({ description })}
          multiline
          maxLength={10000}
          textAlignVertical="top"
          className="min-h-36 rounded-2xl border border-white/10 bg-navy px-4 py-4 text-base text-white"
          placeholder="Where, what you saw and did, in order. Facts only."
          error={errors.description}
        />

        <Input
          label="People involved (optional)"
          value={form.peopleInvolved}
          onChangeText={(peopleInvolved) => update({ peopleInvolved })}
          multiline
          maxLength={4000}
          textAlignVertical="top"
          className="min-h-24 rounded-2xl border border-white/10 bg-navy px-4 py-4 text-base text-white"
          placeholder="Names, descriptions, contact details, witnesses"
          error={errors.peopleInvolved}
        />

        <View className="flex-row items-center justify-between rounded-2xl border border-white/10 bg-navy px-4 py-3">
          <Text className="text-base text-white">Police called</Text>
          <Switch
            value={form.policeCalled}
            onValueChange={(policeCalled) => update({ policeCalled })}
            trackColor={{ true: brand.gold, false: 'rgba(255,255,255,0.2)' }}
            thumbColor={brand.white}
            accessibilityLabel="Police called"
          />
        </View>

        <View className="gap-3">
          <SectionTitle>Photos</SectionTitle>
          {item.existingPhotoCount > 0 ? (
            <Text className="text-sm text-white/60">
              {item.existingPhotoCount} photo{item.existingPhotoCount === 1 ? ' is' : 's are'}{' '}
              already attached. New ones are added to them.
            </Text>
          ) : null}
          {item.photos.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {item.photos.map((p) => (
                <View key={p.id}>
                  <Image
                    source={{ uri: p.localUri }}
                    style={{ width: 96, height: 96, borderRadius: 10 }}
                    contentFit="cover"
                    accessibilityLabel="Attached photo"
                  />
                  <Pressable
                    onPress={() => void removePhoto(p.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    hitSlop={8}
                    className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-black/70"
                  >
                    <Ionicons name="close" size={16} color={brand.white} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {busyPhotos ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator color={brand.gold} />
              <Text className="text-sm text-white/70">Compressing photo…</Text>
            </View>
          ) : room > 0 ? (
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  title="Take photo"
                  variant="secondary"
                  onPress={() => void addPhotos('camera')}
                />
              </View>
              <View className="flex-1">
                <Button
                  title="From gallery"
                  variant="secondary"
                  onPress={() => void addPhotos('library')}
                />
              </View>
            </View>
          ) : (
            <Text className="text-sm text-white/60">{INCIDENT_MAX_PHOTOS} photos at most.</Text>
          )}
          <Text className="text-xs leading-4 text-white/45">
            Photos are made smaller and their location data is removed before they are saved.
          </Text>
          {photoError ? <Notice tone="error">{photoError}</Notice> : null}
        </View>

        {Object.keys(errors).length > 0 ? (
          <Notice tone="error">Some details are missing. Check the highlighted fields.</Notice>
        ) : null}
        <Button
          title={item.mode === 'resubmit' ? 'Resubmit report' : 'Submit report'}
          loading={submitting}
          disabled={busyPhotos}
          onPress={() => void submit()}
        />
        <Text className="text-center text-xs text-white/50">
          {savedAt
            ? `Draft saved on this phone at ${toZoned(new Date(savedAt), tz).time}.`
            : 'Your draft is saved on this phone as you type.'}{' '}
          After you submit, it can&apos;t be changed unless your supervisor returns it.
        </Text>
        <Button
          title={item.mode === 'resubmit' ? 'Discard changes' : 'Delete draft'}
          variant="secondary"
          onPress={remove}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-white/80">{label}</Text>
      {children}
      {error ? <Text className="text-sm text-red-300">{error}</Text> : null}
    </View>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  danger = [],
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  danger?: T[];
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const selected = o.value === value;
        const red = danger.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            className={`min-h-11 justify-center rounded-full border px-4 ${
              selected
                ? red
                  ? 'border-red-400 bg-red-500/80'
                  : 'border-gold bg-gold'
                : 'border-white/15 bg-navy'
            }`}
          >
            <Text
              className={`text-sm font-semibold ${selected ? (red ? 'text-white' : 'text-ink') : 'text-white'}`}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
