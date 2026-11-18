import { ScrollView } from 'react-native';

import { Body, Title } from '@/components/ui';

export default function ShiftsScreen() {
  return (
    <ScrollView className="flex-1 bg-white dark:bg-slate-950" contentContainerClassName="gap-2 p-6">
      <Title>Shifts</Title>
      <Body>Your schedule, shift acknowledgements and GPS clock-in will appear here.</Body>
    </ScrollView>
  );
}
