import type { SosStatus } from '@deltaguard/shared';

import type { BadgeTone } from '@/components/ui';

export const SOS_TONE: Record<SosStatus, BadgeTone> = {
  active: 'bad',
  acknowledged: 'warn',
  resolved: 'good',
  false_alarm: 'neutral',
};
