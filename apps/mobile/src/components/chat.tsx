import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { brand } from '@/lib/theme';

// Small pieces shared by the Messages screens.

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : parts[0]!.slice(0, 2);
  return letters.toUpperCase();
}

/** Initials in a navy circle with a gold ring, or a group icon. */
export function ChatAvatar({
  name,
  group = false,
  size = 44,
}: {
  name: string | null | undefined;
  group?: boolean;
  size?: number;
}) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center border border-gold/50 bg-navy"
    >
      {group ? (
        <Ionicons name="people" size={size * 0.45} color={brand.gold} />
      ) : (
        <Text style={{ fontSize: size * 0.34 }} className="font-bold text-gold">
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

export function UnreadPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View className="min-w-6 items-center rounded-full bg-gold px-1.5 py-0.5">
      <Text className="text-xs font-bold text-ink">{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** "14:05" today, "Mon" this week, else "12 Mar". Phone's own clock and zone. */
export function chatTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  officer: 'Officer',
};
