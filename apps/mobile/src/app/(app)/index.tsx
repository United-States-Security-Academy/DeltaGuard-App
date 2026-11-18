import { COMPANY_NAME } from '@deltaguard/shared';
import { ScrollView, Text } from 'react-native';

import { Body, Title } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function HomeScreen() {
  const { state } = useSession();
  const name = state.status === 'ready' ? state.profile.fullName : null;

  return (
    <ScrollView className="flex-1 bg-white dark:bg-slate-950" contentContainerClassName="gap-2 p-6">
      <Text className="text-sm font-medium uppercase tracking-widest text-slate-500">
        {COMPANY_NAME}
      </Text>
      <Title>{name ? `Welcome, ${name}` : 'Welcome'}</Title>
      <Body>Today&apos;s shift and alerts will appear here.</Body>
    </ScrollView>
  );
}
