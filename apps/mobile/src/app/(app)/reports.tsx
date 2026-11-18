import { ScrollView } from 'react-native';

import { Body, Title } from '@/components/ui';

export default function ReportsScreen() {
  return (
    <ScrollView className="flex-1 bg-white dark:bg-slate-950" contentContainerClassName="gap-2 p-6">
      <Title>Reports</Title>
      <Body>Daily activity and incident reports will appear here.</Body>
    </ScrollView>
  );
}
