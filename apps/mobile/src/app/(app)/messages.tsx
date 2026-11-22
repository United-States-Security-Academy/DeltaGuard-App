import { ScrollView } from 'react-native';

import { Body, Title } from '@/components/ui';

export default function MessagesScreen() {
  return (
    <ScrollView className="flex-1 bg-ink" contentContainerClassName="gap-2 p-6">
      <Title>Messages</Title>
      <Body>Team messages and SOS alerts will appear here.</Body>
    </ScrollView>
  );
}
