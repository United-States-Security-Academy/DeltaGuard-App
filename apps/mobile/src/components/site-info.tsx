import type { SiteContact } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { call } from '@/lib/directions';
import { brand } from '@/lib/theme';

// Site details shared by the Sites tab and the shift detail screen.

export function EmergencyInstructions({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const instructions = text?.trim();
  if (!instructions) return null;

  return (
    <View className="gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name="alert-circle" size={16} color="#fca5a5" />
        <Text className="text-xs font-bold uppercase tracking-wider text-red-200">
          Emergency instructions
        </Text>
      </View>
      <Text className="text-sm leading-5 text-white/90" numberOfLines={expanded ? undefined : 4}>
        {instructions}
      </Text>
      {instructions.length > 160 || instructions.split('\n').length > 4 ? (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          className="self-start py-1"
        >
          <Text className="text-sm font-semibold text-gold">
            {expanded ? 'Show less' : 'Read all'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SiteContacts({ contacts }: { contacts: SiteContact[] }) {
  if (contacts.length === 0) return null;
  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-wider text-white/50">Site contacts</Text>
      {contacts.map((c, i) => (
        <View key={`${c.name}-${i}`} className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-base text-white">{c.name}</Text>
            {c.role ? <Text className="text-xs text-white/50">{c.role}</Text> : null}
          </View>
          {c.phone ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Call ${c.name}`}
              onPress={() => call(c.phone!)}
              className="flex-row items-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 active:opacity-70"
            >
              <Ionicons name="call" size={14} color={brand.gold} />
              <Text className="text-sm font-semibold text-white">Call</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}
