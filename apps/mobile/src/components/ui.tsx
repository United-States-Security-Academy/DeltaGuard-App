import { errorKind, friendlyError } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { brand, fx } from '@/lib/theme';

// Brand palette (tailwind.config.js): ink #050E1D background, navy #10213A
// surfaces, gold #D6B562 actions and highlights, white text. Red is kept only
// for errors so they can't be mistaken for anything else.
//
// Look: flat ink pages, flat navy panels with soft depth, generous rounding
// (pills for controls, 28 px for panels), solid gold for actions and what
// matters now, small uppercase spaced labels. Effects live in `fx` (lib/theme.ts).

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 px-6" style={fx.screen}>
      {children}
    </View>
  );
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
      className={`flex-row items-start gap-3 rounded-3xl border p-4 ${
        error ? 'border-red-400/40 bg-red-500/10' : 'border-gold/25'
      }`}
      style={error ? undefined : fx.glass}
    >
      <View
        className={`h-8 w-8 items-center justify-center rounded-full ${
          error ? 'bg-red-500/15' : 'bg-gold/15'
        }`}
      >
        <Ionicons
          name={error ? 'alert-circle-outline' : 'information-circle-outline'}
          size={18}
          color={error ? '#fca5a5' : brand.gold}
        />
      </View>
      <Text
        accessibilityRole="alert"
        className={`flex-1 self-center text-sm leading-5 ${error ? 'text-red-200' : 'text-white/90'}`}
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
  trailing,
  ...props
}: TextInputProps & {
  label: string;
  error?: string;
  /** Inside the pill on the right, e.g. the show-password button. */
  trailing?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  // Single-line fields are pills; multi-line ones keep corners so text fits.
  const shape = props.multiline ? 'rounded-3xl' : 'rounded-full';
  return (
    <View className="gap-2">
      <Text className="ml-4 text-xs font-semibold uppercase tracking-[2px] text-white/60">
        {label}
      </Text>
      <View className="justify-center">
        <TextInput
          className={`border-2 bg-navy py-4 pl-6 text-base text-white ${trailing ? 'pr-16' : 'pr-6'} ${shape} ${
            error ? 'border-red-400/70' : focused ? 'border-gold' : 'border-gold/15'
          }`}
          style={focused && !error ? fx.focusGlow : undefined}
          placeholderTextColor="rgba(255,255,255,0.38)"
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
        {trailing ? <View className="absolute right-2">{trailing}</View> : null}
      </View>
      {error ? <Text className="ml-4 text-sm text-red-300">{error}</Text> : null}
    </View>
  );
}

/** Password field with an eye button to show what was typed (hidden by default). */
export function PasswordInput(
  props: Omit<TextInputProps, 'secureTextEntry'> & { label: string; error?: string },
) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      trailing={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          className="size-11 items-center justify-center rounded-full active:bg-white/10"
        >
          <Ionicons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={brand.gold}
          />
        </Pressable>
      }
    />
  );
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  ...props
}: Omit<PressableProps, 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}) {
  const primary = variant === 'primary';
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      className={`min-h-14 items-center justify-center rounded-full px-6 py-4 active:opacity-80 ${
        primary ? '' : 'border border-gold/30'
      } ${inactive ? 'opacity-60' : ''}`}
      style={[primary ? fx.gold : fx.glass, primary && inactive ? { boxShadow: 'none' } : null]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={primary ? brand.ink : brand.gold} />
      ) : (
        <Text
          className={`text-base font-bold tracking-wide ${primary ? 'text-ink' : 'text-white'}`}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Round back button, used at the top of auth screens. */
export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-full border border-gold/25 active:opacity-70"
      style={fx.glass}
    >
      <Ionicons name="chevron-back" size={22} color={brand.gold} />
    </Pressable>
  );
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center" style={fx.backdrop}>
      <ActivityIndicator color={brand.gold} />
    </View>
  );
}

/** Glass panel. `tone` adds a glow (warn: needs attention now) or a red edge. */
export function Card({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const border = {
    default: 'border-white/[0.07]',
    warn: 'border-gold/60',
    danger: 'border-red-400/70',
  }[tone];
  return (
    <View
      className={`gap-3 rounded-[28px] border p-5 ${border}`}
      style={tone === 'warn' ? fx.glassGlow : fx.glass}
    >
      {children}
    </View>
  );
}

/** Heading for a group of cards: small, spaced, uppercase. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="ml-1 mt-3 text-xs font-bold uppercase tracking-[3px] text-white/55">
      {children}
    </Text>
  );
}

/** Label / value pair inside a card. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View className="gap-0.5">
      <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-white/45">
        {label}
      </Text>
      {typeof value === 'string' ? <Text className="text-base text-white">{value}</Text> : value}
    </View>
  );
}

/** A gold outline ring with an icon in it (tiles, empty states, modals). */
export function IconRing({ name, size = 56 }: { name: IconName; size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-full border border-gold/40"
      style={{ width: size, height: size, backgroundColor: 'rgba(214,181,98,0.08)' }}
    >
      <Ionicons name={name} size={Math.round(size * 0.45)} color={brand.gold} />
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
    gold: 'border-gold/50 bg-gold/15 text-gold',
    muted: 'border-white/15 bg-white/5 text-white/70',
    danger: 'border-red-400/40 bg-red-500/10 text-red-200',
  }[tone];
  return (
    <Text
      className={`self-start overflow-hidden rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${styles}`}
    >
      {children}
    </Text>
  );
}
