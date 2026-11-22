import { toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { dayLabel } from '@/components/shift-card';
import { Card } from '@/components/ui';
import { useHandover } from '@/lib/dar';
import type { MyShift } from '@/lib/shifts';
import { brand } from '@/lib/theme';

/** Handover notes from the officers before, for a shift that hasn't finished. */
export function HandoverCard({ shift, timeZone }: { shift: MyShift; timeZone: string }) {
  const relevant =
    shift.status !== 'cancelled' && shift.status !== 'completed' && shift.status !== 'missed';
  const handover = useHandover(shift.id, relevant);
  if (!relevant || !handover.data || handover.data.length === 0) return null;

  return (
    <Card tone="warn">
      <View className="flex-row items-center gap-2">
        <Ionicons name="swap-horizontal" size={20} color={brand.gold} />
        <Text className="text-base font-bold text-white">Handover from the previous shift</Text>
      </View>
      {handover.data.map((h) => (
        <View key={h.id} className="gap-1 border-t border-white/10 pt-2">
          <Text className="text-xs uppercase tracking-wider text-white/50">
            {h.officerName ?? 'An officer'} · {dayLabel(h.notedAt, timeZone)}{' '}
            {toZoned(h.notedAt, timeZone).time}
          </Text>
          <Text className="text-base leading-6 text-white/90">{h.note}</Text>
        </View>
      ))}
    </Card>
  );
}
