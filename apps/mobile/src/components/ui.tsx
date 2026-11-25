import { errorKind, friendlyError } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { brand, mutedWhite } from '@/lib/theme';

// Brand palette (tailwind.config.js): ink #050E1D background, navy #10213A
// surfaces, gold #D6B562 actions and highlights, white text. Red is kept only
// for errors so they can't be mistaken for anything else.

export function Screen({ children }: { children: ReactNode }) {
  return <View className="flex-1 bg-ink px-6">{children}</View>;
}

/** Small gold label above a title, e.g. the company name. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-[3px] text-gold">{children}</Text>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-3xl font-bold leading-tight text-white">{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text className="text-base leading-6 text-white/70">{children}</Text>;
}

export function Notice({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  const error = tone === 'error';
  return (
    <View
      className={`flex-row gap-3 rounded-2xl border p-4 ${
        error ? 'border-red-400/40 bg-red-500/10' : 'border-gold/30 bg-navy'
      }`}
    >
      <Ionicons
        name={error ? 'alert-circle-outline' : 'information-circle-outline'}
        size={20}
        color={error ? '#fca5a5' : brand.gold}
      />
      <Text
        accessibilityRole="alert"
        className={`flex-1 text-sm leading-5 ${error ? 'text-red-200' : 'text-white/90'}`}
      >
        {children}
      </Text>
    </View>
  );
}

export function Input({
  label,
  error,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-white/80">{label}</Text>
      <TextInput
        className={`rounded-2xl border bg-navy px-4 py-4 text-base text-white ${
          error ? 'border-red-400/70' : focused ? 'border-gold' : 'border-white/10'
        }`}
        placeholderTextColor={mutedWhite}
        selectionColor={brand.gold}
        cursorColor={brand.gold}
        keyboardAppearance="dark"
        accessibilityLabel={label}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
      {error ? <Text className="text-sm text-red-300">{error}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  ...props
}: PressableProps & { title: string; variant?: 'primary' | 'secondary'; loading?: boolean }) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      className={`min-h-14 items-center justify-center rounded-2xl px-5 py-4 active:opacity-80 ${
        primary ? 'bg-gold' : 'border border-white/15 bg-navy'
      } ${disabled || loading ? 'opacity-60' : ''}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={primary ? brand.ink : brand.gold} />
      ) : (
        <Text className={`text-base font-bold ${primary ? 'text-ink' : 'text-white'}`}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Square back button, used at the top of auth screens. */
export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-navy active:opacity-70"
    >
      <Ionicons name="chevron-back" size={22} color={brand.white} />
    </Pressable>
  );
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-ink">
      <ActivityIndicator color={brand.gold} />
    </View>
  );
}

/** Raised navy panel. `tone` adds a coloured edge for warnings. */
export function Card({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const border = {
    default: 'border-white/10',
    warn: 'border-gold',
    danger: 'border-red-400/70',
  }[tone];
  return <View className={`gap-3 rounded-2xl border bg-navy p-4 ${border}`}>{children}</View>;
}

/** Heading for a group of cards. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text className="mt-2 text-lg font-bold text-white">{children}</Text>;
}

/** Label / value pair inside a card. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View className="gap-0.5">
      <Text className="text-xs uppercase tracking-wider text-white/50">{label}</Text>
      {typeof value === 'string' ? <Text className="text-base text-white">{value}</Text> : value}
    </View>
  );
}

/**
 * A failed load with a retry button. Pass the error to add what to do about it
 * (offline, sign-in expired); the raw technical text is never shown.
 */
export function ErrorState({
  message,
  error,
  onRetry,
}: {
  message: string;
  error?: unknown;
  onRetry: () => void;
}) {
  const hint = error === undefined ? '' : errorHint(error);
  return (
    <View className="gap-3">
      <Notice tone="error">{hint ? `${message} ${hint}` : message}</Notice>
      <Button title="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

/** The "what to do" part of friendlyError, or nothing for unexplained errors. */
function errorHint(error: unknown): string {
  return errorKind(error) === 'unknown' ? '' : friendlyError(error);
}

/** Small status pill. Gold for attention, muted for neutral, red for problems. */
export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'gold' | 'muted' | 'danger';
}) {
  const styles = {
    gold: 'border-gold/40 bg-gold/15 text-gold',
    muted: 'border-white/15 bg-white/5 text-white/70',
    danger: 'border-red-400/40 bg-red-500/10 text-red-200',
  }[tone];
  return (
    <Text
      className={`self-start overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles}`}
    >
      {children}
    </Text>
  );
}
