import {
  formatDate,
  FORM_INBOX_STATUS_LABELS,
  formValueProblems,
  formValuesSchema,
  toZoned,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePreventScreenCapture } from 'expo-screen-capture';

import { FieldSheet, pickDateAndroid } from '@/components/form-field-sheet';
import { type FormPageHandle, FormPages } from '@/components/form-page';
import { FormScrollView } from '@/components/keyboard';
import { SignaturePad } from '@/components/signature-pad';
import { Button, ErrorState, Notice } from '@/components/ui';
import { authenticateOwner } from '@/lib/biometric';
import {
  newLocalForm,
  saveSignaturePng,
  type LocalForm,
  type VersionField,
} from '@/lib/form-store';
import { useFormSync } from '@/lib/form-sync';
import { missingRequired, openFilledPdf, useFormVersion, useServerSubmission } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { useCompanySettings } from '@/lib/shifts';
import { brand, fx } from '@/lib/theme';
import { useLocalImageUri } from '@/lib/local-image';

const SAVE_DELAY_MS = 500;

function withoutKeys(map: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => !keys.includes(k)));
}
const CONFIRM_TEXT =
  'By submitting, you confirm the information is correct and this is your signature.';

export default function FormScreen() {
  // Personal data, photos or answers on screen: no screenshots or recording.
  usePreventScreenCapture('form');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'ready' || typeof id !== 'string') return null;
  return <FormView id={id} userId={state.profile.id} fullName={state.profile.fullName} />;
}

function FormView({
  id,
  userId,
  fullName,
}: {
  id: string;
  userId: string;
  fullName: string | null;
}) {
  const sync = useFormSync();
  const local = sync.items.find((f) => f.id === id) ?? null;
  const server = useServerSubmission(id, true);
  const s = server.data ?? null;

  // Opening a draft or returned form that exists only on the server: keep a
  // copy on the phone to edit (it is what gets sent).
  useEffect(() => {
    if (!sync.loaded || local || !s) return;
    if (s.status !== 'draft' && s.status !== 'returned') return;
    void sync.save(
      id,
      (current) =>
        current ?? {
          ...newLocalForm(id, s.templateId, s.templateVersion, s.assignmentId, s.title ?? 'Form'),
          values: s.values,
          serverRow: true,
          serverSignaturePath: s.signaturePath,
          reviewNotes: s.status === 'returned' ? s.reviewNotes : null,
        },
    );
  }, [sync, local, s, id]);

  if (local && local.state !== 'queued') {
    return <EditForm key={local.id} form={local} userId={userId} fullName={fullName} />;
  }
  if (local?.state === 'queued' || s) {
    return <ReadOnlyForm userId={userId} local={local} submissionId={id} />;
  }
  if (server.isError) {
    return (
      <View className="flex-1 p-5" style={fx.screen}>
        <ErrorState
          message="Couldn't open this form."
          error={server.error}
          onRetry={() => void server.refetch()}
        />
      </View>
    );
  }
  return (
    <View className="flex-1 items-center justify-center" style={fx.screen}>
      <ActivityIndicator color={brand.gold} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filling
// ---------------------------------------------------------------------------

function EditForm({
  form,
  userId,
  fullName,
}: {
  form: LocalForm;
  userId: string;
  fullName: string | null;
}) {
  const sync = useFormSync();
  const insets = useSafeAreaInsets();
  const version = useFormVersion(userId, form.templateId, 'current');
  const [values, setValues] = useState<Record<string, unknown>>(form.values);
  const [mode, setMode] = useState<'pages' | 'list'>('pages');
  const [editing, setEditing] = useState<VersionField | null>(null);
  const [signing, setSigning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>(form.problems);
  const [upgradedFrom, setUpgradedFrom] = useState<number | null>(null);
  const pages = useRef<FormPageHandle>(null);

  // --- Auto-save: every change is written to the phone shortly after ------
  const pending = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    await sync.save(form.id, (c) =>
      c
        ? {
            ...c,
            values: next,
            updatedAt: Date.now(),
            state: c.state === 'failed' ? 'draft' : c.state,
          }
        : c,
    );
  }, [sync, form.id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    return () => {
      sub.remove();
      void flush();
    };
  }, [flush]);

  function setValue(key: string, value: unknown) {
    setValues((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      pending.current = next;
      return next;
    });
    setProblems((p) => withoutKeys(p, [key]));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  // A newer version was published since this draft started: move to it,
  // keeping the answers whose fields still exist.
  const v = version.data;
  const [shownVersion, setShownVersion] = useState(form.templateVersion);
  if (v && v.version !== shownVersion) {
    // Adjust state while rendering (React's pattern for "a prop changed").
    const keys = new Set(v.fields.map((f) => f.key));
    setUpgradedFrom(shownVersion);
    setShownVersion(v.version);
    setValues((current) =>
      Object.fromEntries(Object.entries(current).filter(([k]) => keys.has(k))),
    );
  }
  // ...and record the move on the phone.
  useEffect(() => {
    if (!v || v.version === form.templateVersion) return;
    const keys = new Set(v.fields.map((f) => f.key));
    void sync.save(form.id, (c) =>
      c
        ? {
            ...c,
            templateVersion: v.version,
            title: v.title,
            values: Object.fromEntries(Object.entries(c.values).filter(([k]) => keys.has(k))),
          }
        : c,
    );
  }, [v, form.templateVersion, form.id, sync]);

  const hasSignature = form.signature !== null || form.serverSignaturePath !== null;
  const missing = useMemo(
    () => (v ? missingRequired(v.fields, values, hasSignature) : []),
    [v, values, hasSignature],
  );
  const missingKeys = useMemo(() => new Set(missing.map((f) => f.key)), [missing]);

  function openField(field: VersionField) {
    if (field.type === 'checkbox') return setValue(field.key, values[field.key] !== true);
    if (field.type === 'signature') return setSigning(true);
    if (field.type === 'date' && Platform.OS === 'android') {
      return pickDateAndroid(field, values[field.key], (value) => setValue(field.key, value));
    }
    setEditing(field);
  }

  async function saveSignature(base64: string) {
    setSigning(false);
    const { localUri, fileName } = await saveSignaturePng(userId, form.id, base64);
    await sync.save(form.id, (c) =>
      c
        ? {
            ...c,
            signature: {
              localUri,
              path: `${userId}/${form.id}/${fileName}`,
              uploaded: false,
              attached: false,
            },
            state: c.state === 'failed' ? 'draft' : c.state,
          }
        : c,
    );
    const signatureKeys = (v?.fields ?? []).filter((f) => f.type === 'signature').map((f) => f.key);
    setProblems((p) => withoutKeys(p, signatureKeys));
  }

  async function startSubmit() {
    if (!v) return;
    await flush();
    if (missing.length > 0) {
      Alert.alert(
        missing.length === 1
          ? 'A required field is empty'
          : `${missing.length} required fields are empty`,
        missing
          .map((f) => `• ${f.label}`)
          .slice(0, 8)
          .join('\n'),
      );
      if (mode === 'pages') pages.current?.focus(missing[0]!.key);
      return;
    }
    const checked = formValuesSchema(v.fields, hasSignature).safeParse(values);
    if (!checked.success) {
      const found = Object.fromEntries(
        formValueProblems(checked.error).map((p) => [p.key, p.message]),
      );
      setProblems(found);
      Alert.alert('Check your answers', Object.values(found).slice(0, 6).join('\n'));
      return;
    }
    setAuthError(null);
    setConfirming(true);
  }

  async function confirmAndSign() {
    // Proof that the registered officer signed: the phone's owner must pass
    // Face ID / fingerprint (or the phone's passcode) right now.
    const auth = await authenticateOwner('Confirm it’s you to sign this form');
    if (!auth.ok) {
      setAuthError(auth.message);
      return;
    }
    await flush();
    await sync.save(form.id, (c) => (c ? { ...c, values } : c));
    setConfirming(false);
    await sync.submit(form.id);
  }

  // Before any early return (rules of hooks).
  const signatureUri = useLocalImageUri(userId, form.signature?.localUri ?? null, 'image/png');

  if (version.isError && !v) {
    return (
      <View className="flex-1 p-5" style={fx.screen}>
        <ErrorState
          message="This form isn't on this phone yet, and it couldn't be downloaded."
          error={version.error}
          onRetry={() => void version.refetch()}
        />
      </View>
    );
  }
  if (!v) {
    return (
      <View className="flex-1 items-center justify-center gap-3" style={fx.screen}>
        <ActivityIndicator color={brand.gold} />
        <Text className="text-sm text-white/60">Downloading the form for offline use…</Text>
      </View>
    );
  }


  return (
    <View className="flex-1" style={fx.screen}>
      <Stack.Screen options={{ title: v.title }} />

      <View className="gap-2 px-4 pt-3">
        {form.reviewNotes ? (
          <Notice tone="info">Returned by your supervisor: “{form.reviewNotes}”</Notice>
        ) : null}
        {form.state === 'failed' && form.lastError ? (
          <Notice tone="error">Not accepted: {form.lastError}</Notice>
        ) : null}
        {upgradedFrom !== null ? (
          <Notice tone="info">
            This form was updated (version {upgradedFrom} → {v.version}). Your answers were kept;
            check any new fields.
          </Notice>
        ) : null}
        <View className="flex-row items-center justify-between gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          {missing.length > 0 ? (
            <Pressable
              onPress={() =>
                mode === 'pages' ? pages.current?.focus(missing[0]!.key) : openField(missing[0]!)
              }
              className="flex-row items-center gap-1.5 rounded-full border border-red-400/50 bg-red-500/10 px-3 py-1.5"
              accessibilityRole="button"
              accessibilityLabel={`${missing.length} required fields empty. Go to the next one.`}
            >
              <Ionicons name="alert-circle" size={14} color="#fca5a5" />
              <Text className="text-xs font-bold text-red-200">
                {missing.length} required empty
              </Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center gap-1.5 rounded-full border border-gold/40 px-3 py-1.5">
              <Ionicons name="checkmark-circle" size={14} color={brand.gold} />
              <Text className="text-xs font-bold text-gold">All required filled</Text>
            </View>
          )}
        </View>
      </View>

      <View className="mt-2 flex-1">
        {mode === 'pages' ? (
          <FormPages
            ref={pages}
            version={v}
            values={values}
            signatureUri={signatureUri}
            missing={missingKeys}
            problems={problems}
            readOnly={false}
            onFieldPress={openField}
          />
        ) : (
          <ListForm
            fields={v.fields}
            values={values}
            signatureUri={signatureUri}
            hasSignature={hasSignature}
            missing={missingKeys}
            problems={problems}
            onText={(key, value) => setValue(key, value === '' ? undefined : value)}
            onOpen={openField}
          />
        )}
      </View>

      <View
        className="gap-1 border-t border-white/10 px-5 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <Button title="Sign and submit" onPress={() => void startSubmit()} />
        <Text className="text-center text-xs text-white/45">Saved on this phone as you go.</Text>
      </View>

      <FieldSheet
        // A fresh sheet (and draft) for each field.
        key={editing?.key ?? 'closed'}
        field={editing}
        value={editing ? values[editing.key] : undefined}
        problem={editing ? problems[editing.key] : undefined}
        onChange={(value) => editing && setValue(editing.key, value)}
        onClose={() => setEditing(null)}
      />
      <SignaturePad
        visible={signing}
        name={fullName}
        onDone={(png) => void saveSignature(png)}
        onCancel={() => setSigning(false)}
      />
      <Modal
        visible={confirming}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirming(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/60 p-6">
          <View
            className="w-full max-w-md gap-4 rounded-[28px] border border-gold/40 p-6"
            style={fx.glassGlow}
          >
            <Ionicons name="finger-print" size={36} color={brand.gold} />
            <Text className="text-xl font-extrabold text-white">Sign and submit</Text>
            <Text className="text-base leading-6 text-white/85">{CONFIRM_TEXT}</Text>
            <Text className="text-sm text-white/55">
              Next, confirm it’s you with Face ID, your fingerprint or your phone’s passcode.
            </Text>
            {authError ? <Notice tone="error">{authError}</Notice> : null}
            <Button title="Confirm and sign" onPress={() => void confirmAndSign()} />
            <Button title="Cancel" variant="secondary" onPress={() => setConfirming(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: 'pages' | 'list';
  onChange: (m: 'pages' | 'list') => void;
}) {
  return (
    <View className="flex-row rounded-full border border-white/10 p-0.5" style={fx.glass}>
      {(
        [
          ['pages', 'document-outline', 'Pages'],
          ['list', 'list-outline', 'List'],
        ] as const
      ).map(([value, icon, label]) => (
        <Pressable
          key={value}
          onPress={() => onChange(value)}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === value }}
          className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${mode === value ? 'bg-gold' : ''}`}
        >
          <Ionicons name={icon} size={14} color={mode === value ? brand.ink : brand.gold} />
          <Text className={`text-xs font-bold ${mode === value ? 'text-ink' : 'text-white/80'}`}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function displayValue(field: VersionField, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (field.type === 'checkbox') return value === true ? 'Yes' : 'No';
  if (field.type === 'date' && typeof value === 'string') {
    const [y, m, d] = value.split('-');
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

/** Every field as a simple scrolling form (easier on small screens). */
function ListForm({
  fields,
  values,
  signatureUri,
  hasSignature,
  missing,
  problems,
  onText,
  onOpen,
  readOnly = false,
}: {
  fields: VersionField[];
  values: Record<string, unknown>;
  signatureUri: string | null;
  hasSignature: boolean;
  missing: Set<string>;
  problems: Record<string, string>;
  onText?: (key: string, value: string) => void;
  onOpen?: (field: VersionField) => void;
  readOnly?: boolean;
}) {
  return (
    <FormScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-10 pt-2">
      {fields.map((f) => {
        const flagged = missing.has(f.key) || problems[f.key];
        const text = displayValue(f, values[f.key]);
        return (
          <View key={f.key} className="gap-2">
            <Text className="ml-4 text-xs font-semibold uppercase tracking-[2px] text-white/60">
              {f.label}
              {f.required ? <Text className="text-gold"> *</Text> : null}
            </Text>
            {!readOnly && (f.type === 'text' || f.type === 'multiline') ? (
              <TextInput
                defaultValue={typeof values[f.key] === 'string' ? (values[f.key] as string) : ''}
                onChangeText={(t) => onText?.(f.key, t)}
                multiline={f.type === 'multiline'}
                className={`border-2 bg-navy px-6 py-4 text-base text-white ${
                  f.type === 'multiline' ? 'min-h-28 rounded-3xl' : 'rounded-full'
                } ${flagged ? 'border-red-400/70' : 'border-gold/15'}`}
                style={f.type === 'multiline' ? { textAlignVertical: 'top' } : undefined}
                placeholderTextColor="rgba(255,255,255,0.38)"
                placeholder={f.required ? 'Required' : 'Optional'}
                selectionColor={brand.gold}
                keyboardAppearance="dark"
                accessibilityLabel={f.label}
              />
            ) : (
              <Pressable
                disabled={readOnly}
                onPress={() => onOpen?.(f)}
                accessibilityRole="button"
                accessibilityLabel={`${f.label}: ${text ?? 'empty'}`}
                className={`min-h-14 flex-row items-center justify-between gap-3 rounded-full border-2 bg-navy px-6 py-3 ${
                  flagged ? 'border-red-400/70' : 'border-gold/15'
                }`}
              >
                {f.type === 'signature' ? (
                  signatureUri ? (
                    <Image
                      source={{ uri: signatureUri }}
                      style={{ height: 40, flex: 1 }}
                      contentFit="contain"
                    />
                  ) : (
                    <Text className="text-base text-white/60">
                      {hasSignature ? 'Signed earlier' : 'Tap to sign'}
                    </Text>
                  )
                ) : f.type === 'checkbox' ? (
                  <Text className="text-base text-white">
                    {values[f.key] === true ? 'Yes' : 'No'}
                  </Text>
                ) : (
                  <Text className={`flex-1 text-base ${text ? 'text-white' : 'text-white/40'}`}>
                    {text ?? (f.required ? 'Required' : 'Optional')}
                  </Text>
                )}
                {!readOnly ? (
                  <Ionicons
                    name={
                      f.type === 'checkbox'
                        ? values[f.key] === true
                          ? 'checkbox'
                          : 'square-outline'
                        : f.type === 'date'
                          ? 'calendar-outline'
                          : f.type === 'signature'
                            ? 'create-outline'
                            : 'chevron-down'
                    }
                    size={20}
                    color={brand.gold}
                  />
                ) : null}
              </Pressable>
            )}
            {problems[f.key] ? (
              <Text className="ml-4 text-sm text-red-300">{problems[f.key]}</Text>
            ) : null}
          </View>
        );
      })}
    </FormScrollView>
  );
}

// ---------------------------------------------------------------------------
// After submitting: read-only
// ---------------------------------------------------------------------------

function ReadOnlyForm({
  userId,
  local,
  submissionId,
}: {
  userId: string;
  local: LocalForm | null;
  submissionId: string;
}) {
  const signatureUri = useLocalImageUri(userId, local?.signature?.localUri ?? null, 'image/png');
  const sync = useFormSync();
  const server = useServerSubmission(submissionId, true);
  const s = server.data ?? null;
  const { timeZone } = useCompanySettings();
  const templateId = local?.templateId ?? s?.templateId ?? null;
  const versionNumber = local?.templateVersion ?? s?.templateVersion ?? 'current';
  const version = useFormVersion(userId, templateId, versionNumber);
  const [mode, setMode] = useState<'pages' | 'list'>('pages');
  const [opening, setOpening] = useState(false);
  const values = local?.values ?? s?.values ?? {};
  const v = version.data;

  const when = (iso: string) => {
    const z = toZoned(iso, timeZone);
    return `${formatDate(z.date)} ${z.time}`;
  };

  async function viewPdf() {
    setOpening(true);
    try {
      await openFilledPdf(submissionId, v?.title ?? 'Form');
    } catch (e) {
      Alert.alert('Couldn’t open the PDF', (e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  return (
    <View className="flex-1" style={fx.screen}>
      <Stack.Screen options={{ title: v?.title ?? s?.title ?? 'Form' }} />
      <View className="gap-2 px-4 pt-3">
        {local?.state === 'queued' ? (
          <Notice tone="info">
            {sync.sendingId === local.id
              ? 'Sending…'
              : 'Signed and saved on this phone. It will be sent automatically when there’s signal.'}
            {local.lastError ? ` (Last try: ${local.lastError})` : ''}
          </Notice>
        ) : s ? (
          <Notice tone="info">
            {FORM_INBOX_STATUS_LABELS[s.status]}
            {s.submittedAt ? ` · submitted ${when(s.submittedAt)}` : ''}
            {s.status === 'approved' && s.reviewedAt ? ` · approved ${when(s.reviewedAt)}` : ''}
          </Notice>
        ) : null}
        <View className="flex-row items-center justify-between gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          {local?.state === 'queued' ? (
            <Pressable
              onPress={() => void sync.syncNow()}
              className="rounded-full border border-gold/40 px-3 py-1.5"
            >
              <Text className="text-xs font-bold text-gold">Try now</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View className="mt-2 flex-1">
        {!v ? (
          version.isError ? (
            <View className="p-5">
              <Notice tone="info">
                This form can’t be shown on the phone any more. Open the PDF instead.
              </Notice>
            </View>
          ) : (
            <ActivityIndicator color={brand.gold} className="mt-10" />
          )
        ) : mode === 'pages' ? (
          <FormPages
            version={v}
            values={values}
            signatureUri={signatureUri}
            missing={new Set()}
            problems={{}}
            readOnly
            onFieldPress={() => {}}
          />
        ) : (
          <ListForm
            fields={v.fields}
            values={values}
            signatureUri={signatureUri}
            hasSignature
            missing={new Set()}
            problems={{}}
            readOnly
          />
        )}
      </View>
      {s?.hasPdf ? (
        <View className="border-t border-white/10 px-5 pb-8 pt-3">
          <Button title="View the signed PDF" loading={opening} onPress={() => void viewPdf()} />
        </View>
      ) : null}
    </View>
  );
}
