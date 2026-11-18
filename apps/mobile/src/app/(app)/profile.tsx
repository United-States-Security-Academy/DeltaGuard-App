import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Body, Button, Title } from '@/components/ui';
import { getOrCreateDeviceId } from '@/lib/device';
import { useSession } from '@/lib/session';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5 border-b border-slate-200 py-3 dark:border-slate-800">
      <Text className="text-sm text-slate-500">{label}</Text>
      <Text className="text-base text-slate-900 dark:text-white">{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { state, signOut } = useSession();
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    void getOrCreateDeviceId().then(setDeviceId);
  }, []);

  if (state.status !== 'ready') return null;
  const { profile, email } = state;

  return (
    <ScrollView className="flex-1 bg-white dark:bg-slate-950" contentContainerClassName="gap-4 p-6">
      <Title>{profile.fullName ?? 'Your profile'}</Title>
      <View>
        <Row label="Email" value={email ?? '—'} />
        <Row label="Role" value={profile.role} />
        {/* Shown so an admin can confirm which phone is registered. */}
        <Row label="Device ID" value={deviceId ? `${deviceId.slice(0, 8)}…` : '…'} />
      </View>
      <Body>Contact details, qualifications and licence expiry will appear here.</Body>
      <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
    </ScrollView>
  );
}
