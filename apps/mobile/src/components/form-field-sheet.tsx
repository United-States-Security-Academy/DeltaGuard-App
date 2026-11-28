import { FORM_MULTILINE_MAX, FORM_TEXT_MAX } from '@deltaguard/shared';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { KeyboardAvoidingView } from '@/components/keyboard';
import { Button } from '@/components/ui';
import type { VersionField } from '@/lib/form-store';
import { brand, fx } from '@/lib/theme';

// The native input for one field, in a bottom sheet: the keyboard for text
// and numbers, the system date picker for dates, a list for choices.
// (Checkboxes toggle in place; signatures open the signature pad.)

/** "YYYY-MM-DD" <-> a local Date (the date picker works in local time). */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Android shows the date picker as its own dialog, without our sheet. */
export function pickDateAndroid(
  field: VersionField,
  value: unknown,
  onChange: (v: unknown) => void,
) {
  DateTimePickerAndroid.open({
    value: parseIsoDate(value) ?? new Date(),
    mode: 'date',
    title: field.label,
    onChange: (event, date) => {
      if (event.type === 'set' && date) onChange(toIsoDate(date));
    },
  });
}

export function FieldSheet({
  field,
  value,
  problem,
  onChange,
  onClose,
}: {
  field: VersionField | null;
  value: unknown;
  problem?: string;
  onChange: (value: unknown) => void;
  onClose: () => void;
}) {
  // The parent remounts the sheet per field (key), so this starts from its value.
  const [draft, setDraft] = useState<unknown>(value);

  if (!field) return null;
  const isText = field.type === 'text' || field.type === 'multiline' || field.type === 'number';

  function done() {
    if (field?.type === 'number') {
      const text = typeof draft === 'string' ? draft.trim().replace(',', '.') : draft;
      onChange(text === '' || text === undefined ? undefined : Number(text));
    } else {
      onChange(typeof draft === 'string' && draft.trim() === '' ? undefined : draft);
    }
    onClose();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50" onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView>
        <View className="gap-4 rounded-t-[32px] border-t border-gold/30 p-6 pb-10" style={fx.glass}>
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-lg font-extrabold text-white">
              {field.label}
              {field.required ? <Text className="text-gold"> *</Text> : null}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={brand.gold} />
            </Pressable>
          </View>

          {isText ? (
            <TextInput
              autoFocus
              value={draft === undefined || draft === null ? '' : String(draft)}
              onChangeText={setDraft}
              multiline={field.type === 'multiline'}
              maxLength={field.type === 'multiline' ? FORM_MULTILINE_MAX : FORM_TEXT_MAX}
              keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
              returnKeyType={field.type === 'multiline' ? 'default' : 'done'}
              onSubmitEditing={field.type === 'multiline' ? undefined : done}
              className={`border-2 border-gold/40 bg-navy px-5 py-4 text-base text-white ${
                field.type === 'multiline' ? 'min-h-40 rounded-3xl' : 'rounded-full'
              }`}
              style={field.type === 'multiline' ? { textAlignVertical: 'top' } : undefined}
              placeholder={field.type === 'number' ? '0' : 'Type here'}
              placeholderTextColor="rgba(255,255,255,0.38)"
              selectionColor={brand.gold}
              keyboardAppearance="dark"
              accessibilityLabel={field.label}
            />
          ) : field.type === 'date' ? (
            <DateTimePicker
              value={parseIsoDate(draft) ?? new Date()}
              mode="date"
              display="inline"
              themeVariant="dark"
              accentColor={brand.gold}
              onChange={(_e, date) => date && setDraft(toIsoDate(date))}
            />
          ) : field.type === 'select' ? (
            <ScrollView className="max-h-80" contentContainerClassName="gap-2">
              {(field.options ?? []).map((option) => {
                const selected = draft === option;
                return (
                  <Pressable
                    key={option}
                    onPress={() => {
                      onChange(option);
                      onClose();
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    className={`flex-row items-center justify-between rounded-full border px-5 py-4 ${
                      selected ? 'border-gold bg-gold/15' : 'border-white/10'
                    }`}
                  >
                    <Text className="flex-1 text-base text-white">{option}</Text>
                    {selected ? <Ionicons name="checkmark" size={20} color={brand.gold} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {problem ? <Text className="text-sm text-red-300">{problem}</Text> : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button
                title="Clear"
                variant="secondary"
                onPress={() => {
                  onChange(undefined);
                  onClose();
                }}
              />
            </View>
            {field.type !== 'select' ? (
              <View className="flex-1">
                <Button title="Done" onPress={done} />
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
