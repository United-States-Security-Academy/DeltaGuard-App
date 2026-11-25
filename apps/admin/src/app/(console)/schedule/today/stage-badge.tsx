import { Badge } from '@/components/ui';

import type { BoardRow } from './board';

export function StageBadge({ row }: { row: Pick<BoardRow, 'stage' | 'status' | 'minutesLate'> }) {
  switch (row.stage) {
    case 'not_in':
      return <Badge tone="bad">Not clocked in · {row.minutesLate} min</Badge>;
    case 'missed':
      return <Badge tone="bad">Missed</Badge>;
    case 'on_shift':
      return <Badge tone="good">On shift</Badge>;
    case 'upcoming':
      return (
        <Badge>{row.status === 'acknowledged' ? 'Upcoming · acknowledged' : 'Upcoming'}</Badge>
      );
    case 'finished':
      return <Badge>Finished</Badge>;
  }
}
