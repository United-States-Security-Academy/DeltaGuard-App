import {
  DAR_ENTRY_LABELS,
  DAR_ENTRY_TYPES,
  type DarEntryType,
  formatTimeRange,
  toZoned,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNow } from '@/components/clock-panel';
import { dayLabel } from '@/components/shift-card';
import { Badge, Body, Button, Card, ErrorState, Notice, SectionTitle } from '@/components/ui';
import {
  type DarEntry,
  type PickedPhoto,
  type ShiftReport,
  useAddDarEntry,
  usePhotoUrl,
  useShiftReport,
} from '@/lib/dar';
import { useSession } from '@/lib/session';
import {
  acceptedEvent,
  type CompanySettings,
  type MyShift,
  useCompanySettings,
  useMyShifts,
} from '@/lib/shifts';
import { brand } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<DarEntryType, IconName> = {
  patrol: 'walk-outline',
  observation: 'eye-outline',
  visitor: 'person-add-outline',
  handover: 'swap-horizontal',
  other: 'create-outline',
};

/** What each quick-add button starts with. */
const TEMPLATES: Record<DarEntryType, { text: string; placeholder: string }> = {
  patrol: {
    text: 'Patrol completed. All secure.',
    placeholder: 'Route, what you checked, anything found',
  },
  observation: { text: '', placeholder: 'What did you see? Where?' },
  visitor: { text: '', placeholder: 'Name, company, who they visited, time in/out' },
  handover: { text: '', placeholder: 'What the next officer should know' },
  other: { text: '', placeholder: 'What happened?' },
};

/** Entries can be added during the shift and up to 12 hours after it ends. */
function reportOpen(shift: MyShift, now: number): boolean {
  if (shift.status === 'in_progress') return true;
  return shift.status === 'completed' && now < Date.parse(shift.endsAt) + 12 * 60 * 60_000;
}

export default function ShiftReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <ShiftReportView shiftId={id} userId={state.profile.id} />;
}

function ShiftReportView({ shiftId, userId }: { shiftId: string; userId: string }) {
  const shifts = useMyShifts(userId);
  const settings = useCompanySettings();
  const report = useShiftReport(shiftId);
  const now = useNow();
  const [composing, setComposing] = useState<DarEntryType | null>(null);
  const shift = shifts.data?.find((s) => s.id === shiftId);

  if (report.isPending || shifts.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
        <ActivityIndicator color={brand.gold} />
      </View>
    );
  }
  if (report.isError) {
    return (
      <View className="flex-1 bg-ink p-5">
        <ErrorState message="Couldn't load the report." onRetry={() => void report.refetch()} />
      </View>
    );
  }

  const data = report.data;
  const open = shift ? reportOpen(shift, now) : false;

  return (
    <>
      <ScrollView
        className="flex-1 bg-ink"
        contentContainerClassName="gap-4 p-5 pb-10"
        refreshControl={
          <RefreshControl
            refreshing={report.isRefetching}
            onRefresh={() => void report.refetch()}
            tintColor={brand.gold}
            colors={[brand.gold]}
          />
        }
      >
        {shift ? (
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wider text-gold">
              {dayLabel(shift.startsAt, settings.timeZone)} ·{' '}
              {formatTimeRange(shift.startsAt, shift.endsAt, settings.timeZone)}
            </Text>
            <Text className="text-2xl font-bold text-white">{shift.site?.name ?? 'Shift'}</Text>
          </View>
        ) : null}

        {!data ? (
          <NoReport shift={shift} />
        ) : open ? (
          <QuickAdd onPick={setComposing} />
        ) : (
          <Notice tone="info">
            This report is closed. Entries can be added until 12 hours after the shift ends.
          </Notice>
        )}

        {data ? <Entries report={data} settings={settings} /> : null}
      </ScrollView>

      {data && composing ? (
        <Composer
          key={composing}
          initialType={composing}
          report={data}
          shiftId={shiftId}
          userId={userId}
          onClose={() => setComposing(null)}
        />
      ) : null}
    </>
  );
}

function NoReport({ shift }: { shift: MyShift | undefined }) {
  const clockedIn = shift ? acceptedEvent(shift, 'clock_in') !== null : false;
  return (
    <Notice tone="info">
      {clockedIn
        ? 'Your report is being set up. Pull down to refresh.'
        : 'Your daily activity report starts when you clock in. If you clocked in offline, it appears once your clock-in has been sent.'}
    </Notice>
  );
}

function QuickAdd({ onPick }: { onPick: (type: DarEntryType) => void }) {
  return (
    <View className="gap-2">
      <SectionTitle>Add an entry</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {DAR_ENTRY_TYPES.map((type) => (
          <Pressable
            key={type}
            onPress={() => onPick(type)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${DAR_ENTRY_LABELS[type].toLowerCase()} entry`}
            className="min-h-20 grow basis-[31%] items-center justify-center gap-1.5 rounded-2xl border border-gold/30 bg-navy p-3 active:opacity-70"
          >
            <Ionicons name={ICONS[type]} size={24} color={brand.gold} />
            <Text className="text-sm font-semibold text-white">{DAR_ENTRY_LABELS[type]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Entries({ report, settings }: { report: ShiftReport; settings: CompanySettings }) {
  return (
    <View className="gap-3">
      <SectionTitle>
        Entries{report.entries.length > 0 ? ` (${report.entries.length})` : ''}
      </SectionTitle>
      {report.entries.length === 0 ? (
        <Body>Nothing logged yet. Use the buttons above to record patrols, visitors and more.</Body>
      ) : (
        report.entries.map((e) => <EntryCard key={e.id} entry={e} timeZone={settings.timeZone} />)
      )}
    </View>
  );
}

function EntryCard({ entry, timeZone }: { entry: DarEntry; timeZone: string }) {
  return (
    <Card>
      <View className="flex-row items-center gap-2">
        <Ionicons name={ICONS[entry.type]} size={18} color={brand.gold} />
        <Text className="text-base font-bold text-white">
          {toZoned(entry.occurredAt, timeZone).time}
        </Text>
        <Badge tone={entry.type === 'handover' ? 'gold' : 'muted'}>
          {DAR_ENTRY_LABELS[entry.type]}
        </Badge>
      </View>
      <Text className="text-base leading-6 text-white/90">{entry.description}</Text>
      {entry.photoPath ? <EntryPhoto path={entry.photoPath} /> : null}
    </Card>
  );
}

function EntryPhoto({ path }: { path: string }) {
  const url = usePhotoUrl(path);
  if (url.isError)
    return <Text className="text-sm text-white/50">Couldn&apos;t load the photo.</Text>;
  return (
    <View className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-ink">
      {url.data ? (
        <Image
          source={{ uri: url.data }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          accessibilityLabel="Photo attached to this entry"
        />
      ) : (
        <ActivityIndicator className="flex-1" color={brand.gold} />
      )}
    </View>
  );
}

/** Bottom sheet to write one entry, with an optional photo. */
function Composer({
  initialType,
  report,
  shiftId,
  userId,
  onClose,
}: {
  initialType: DarEntryType;
  report: ShiftReport;
  shiftId: string;
  userId: string;
  onClose: () => void;
}) {
  const [type, setType] = useState(initialType);
  const [text, setText] = useState(TEMPLATES[initialType].text);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const add = useAddDarEntry(shiftId, userId);

  async function pick(source: 'camera' | 'library') {
    setPhotoError(null);
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      quality: 0.5,
      base64: true,
      exif: false,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPhotoError('Camera access is off for DeltaGuard. Allow it in Settings to take photos.');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    if (!asset.base64) {
      setPhotoError('Couldn’t read that photo. Try another one.');
      return;
    }
    setPhoto({ base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg', uri: asset.uri });
  }

  function save() {
    add.mutate({ reportId: report.id, type, description: text, photo }, { onSuccess: onClose });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-ink">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <View className="flex-row items-center justify-between border-b border-white/10 px-5 py-3">
            <Text className="text-lg font-bold text-white">New entry</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
            >
              <Ionicons name="close" size={24} color={brand.white} />
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
            <View className="flex-row flex-wrap gap-2">
              {DAR_ENTRY_TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: t === type }}
                  className={`rounded-full border px-3 py-1.5 ${
                    t === type ? 'border-gold bg-gold' : 'border-white/15 bg-navy'
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${t === type ? 'text-ink' : 'text-white'}`}
                  >
                    {DAR_ENTRY_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoFocus={TEMPLATES[initialType].text === ''}
              maxLength={4000}
              placeholder={TEMPLATES[type].placeholder}
              placeholderTextColor="rgba(255,255,255,0.4)"
              selectionColor={brand.gold}
              keyboardAppearance="dark"
              accessibilityLabel="Description"
              textAlignVertical="top"
              className="min-h-36 rounded-2xl border border-white/10 bg-navy px-4 py-3 text-base text-white"
            />
            {type === 'handover' ? (
              <Text className="text-xs leading-4 text-white/50">
                Handover entries are shown to the next officer at this site.
              </Text>
            ) : null}

            {photo ? (
              <View className="gap-2">
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 12 }}
                  contentFit="cover"
                  accessibilityLabel="Selected photo"
                />
                <Button title="Remove photo" variant="secondary" onPress={() => setPhoto(null)} />
              </View>
            ) : (
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button
                    title="Take photo"
                    variant="secondary"
                    onPress={() => void pick('camera')}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    title="Choose photo"
                    variant="secondary"
                    onPress={() => void pick('library')}
                  />
                </View>
              </View>
            )}
            {photoError ? <Notice tone="error">{photoError}</Notice> : null}
            {add.isError ? (
              <Notice tone="error">
                Couldn&apos;t save: {add.error.message}. Check your connection and try again.
              </Notice>
            ) : null}

            <Button
              title="Save entry"
              loading={add.isPending}
              disabled={text.trim() === ''}
              onPress={save}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
