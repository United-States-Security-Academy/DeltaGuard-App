import { INCIDENT_STATUS_LABELS, type IncidentStatus, toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Text, View } from 'react-native';

import { Badge } from '@/components/ui';
import type { LocalIncident } from '@/lib/incident-store';
import { type SyncStatus, syncStatus, useIncidentSync } from '@/lib/incident-sync';
import { brand } from '@/lib/theme';

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const tone = status === 'returned' ? 'gold' : status === 'approved' ? 'muted' : 'muted';
  return (
    <Badge tone={tone}>
      {status === 'returned' ? 'Returned: needs changes' : INCIDENT_STATUS_LABELS[status]}
    </Badge>
  );
}

function photos(uploaded: number, total: number): string {
  return total === 0 ? '' : ` · ${uploaded} of ${total} photo${total === 1 ? '' : 's'} sent`;
}

function describe(status: SyncStatus, timeZone: string): { text: string; detail?: string } {
  switch (status.kind) {
    case 'draft':
      return { text: 'Draft · saved on this phone' };
    case 'sending':
      return {
        text:
          status.uploaded < status.total
            ? `Sending photo ${status.uploaded + 1} of ${status.total}…`
            : 'Sending report…',
      };
    case 'waiting':
      return {
        text: `Waiting to send${photos(status.uploaded, status.total)}`,
        detail: status.error
          ? `No connection to the server${
              status.retryAt
                ? `. Trying again at ${toZoned(new Date(status.retryAt), timeZone).time}`
                : ''
            }, or sooner when you're back online.`
          : 'Will send automatically when there is a connection.',
      };
    case 'failed':
      return { text: 'Not accepted: open it to fix', detail: status.error };
  }
}

/** One line (plus detail) saying where a local report is in the queue. */
export function SyncLine({ item, timeZone }: { item: LocalIncident; timeZone: string }) {
  const { sendingId } = useIncidentSync();
  const status = syncStatus(item, sendingId);
  const { text, detail } = describe(status, timeZone);
  const colour =
    status.kind === 'failed'
      ? 'text-red-200'
      : status.kind === 'draft'
        ? 'text-white/60'
        : 'text-gold';

  return (
    <View className="gap-0.5">
      <View className="flex-row items-center gap-1.5">
        {status.kind === 'sending' ? (
          <ActivityIndicator size="small" color={brand.gold} />
        ) : (
          <Ionicons
            name={
              status.kind === 'draft'
                ? 'create-outline'
                : status.kind === 'failed'
                  ? 'alert-circle-outline'
                  : 'cloud-upload-outline'
            }
            size={16}
            color={status.kind === 'failed' ? '#fca5a5' : brand.gold}
          />
        )}
        <Text className={`text-sm font-semibold ${colour}`}>{text}</Text>
      </View>
      {detail ? <Text className="text-xs leading-4 text-white/55">{detail}</Text> : null}
    </View>
  );
}
