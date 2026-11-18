import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

export function Screen({ children }: { children: ReactNode }) {
  return <View className="flex-1 bg-white px-6 dark:bg-slate-950">{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-2xl font-bold text-slate-900 dark:text-white">{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text className="text-base text-slate-600 dark:text-slate-300">{children}</Text>;
}

export function Notice({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <View
      className={`rounded-xl p-3 ${tone === 'error' ? 'bg-red-50 dark:bg-red-950' : 'bg-slate-100 dark:bg-slate-900'}`}
    >
      <Text
        accessibilityRole="alert"
        className={
          tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-slate-700 dark:text-slate-200'
        }
      >
        {children}
      </Text>
    </View>
  );
}

export function Input({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View className="gap-1">
      <Text className="font-medium text-slate-900 dark:text-white">{label}</Text>
      <TextInput
        className="rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:text-white"
        placeholderTextColor="#94a3b8"
        accessibilityLabel={label}
        {...props}
      />
      {error ? <Text className="text-red-600 dark:text-red-400">{error}</Text> : null}
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
      className={`items-center rounded-xl px-4 py-3 active:opacity-80 ${
        primary ? 'bg-slate-900 dark:bg-white' : 'border border-slate-300 dark:border-slate-700'
      } ${disabled || loading ? 'opacity-50' : ''}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={primary ? '#94a3b8' : undefined} />
      ) : (
        <Text
          className={`text-base font-semibold ${primary ? 'text-white dark:text-slate-900' : 'text-slate-900 dark:text-white'}`}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-slate-950">
      <ActivityIndicator />
    </View>
  );
}
