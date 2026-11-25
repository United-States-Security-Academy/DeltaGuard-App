import {
  acknowledgeSosSchema,
  friendlyError,
  mapLink,
  resolveSosSchema,
  SOS_STATUS_LABELS,
  type SosStatus,
  type Tables,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Button, Card, ErrorState, Input, Loading, Notice } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { brand } from '@/lib/theme';

type Alert = Tables<'sos_alerts'>;

/**
 * A supervisor's or admin's view of an SOS on the phone (opened from the push):
 * where the officer is, call them, acknowledge, resolve. The admin console has
 * the full view with the live map and log.
 */
export default function SosAlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'ready' || !id) return null;
  if (state.profile.role === 'officer') {
    return (
      <View className="flex-1 bg-ink p-6">
        <Notice tone="info">Only supervisors and admins can open SOS alerts.</Notice>
      </View>
    );
  }
  return <StaffAlert alertId={id} />;
}

function StaffAlert({ alertId }: { alertId: string }) {
  const client = useQueryClient();
  const key = ['sos-alert', alertId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Alert> => {
      const { data, error } = await supabase
        .from('sos_alerts')
        .select('*')
        .eq('id', alertId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This alert isn’t available.');
      return data;
    },
  });
  const alert = query.data ?? null;
  const setAlert = (next: Alert) => client.setQueryData(key, next);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Live: acknowledged / resolved by someone else, new positions.
  useEffect(() => {
    const channel = supabase
      .channel(`sos-staff:${alertId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: `id=eq.${alertId}` },
        (payload) => client.setQueryData(['sos-alert', alertId], payload.new as Alert),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [alertId, client]);

  async function acknowledge() {
    const input = acknowledgeSosSchema.parse({ p_alert_id: alertId, p_notes: notes || undefined });
    setBusy(true);
    const { data, error } = await supabase.rpc('acknowledge_sos', input);
    setBusy(false);
    if (error) return setActionError(friendlyError(error, { action: 'acknowledge the alert' }));
    setActionError(null);
    setNotes('');
    setAlert(data);
  }

  async function resolve(status: 'resolved' | 'false_alarm') {
    const parsed = resolveSosSchema.safeParse({
      p_alert_id: alertId,
      p_status: status,
      p_notes: notes,
    });
    if (!parsed.success) return setActionError(parsed.error.issues[0]?.message ?? 'Add a note');
    setBusy(true);
    const { data, error } = await supabase.rpc('resolve_sos', parsed.data);
    setBusy(false);
    if (error) return setActionError(friendlyError(error, { action: 'close the alert' }));
    setActionError(null);
    setNotes('');
    setAlert(data);
  }

  if (query.isError) {
    return (
      <ErrorState
        message="Couldn’t load this alert."
        onRetry={() => void query.refetch()}
        error={query.error}
      />
    );
  }
  if (!alert) return <Loading />;

  const open = alert.status === 'active' || alert.status === 'acknowledged';
  const statusColour: Record<SosStatus, string> = {
    active: 'bg-red-600',
    acknowledged: 'bg-amber-500',
    resolved: 'bg-emerald-600',
    false_alarm: 'bg-white/20',
  };

  return (
    <ScrollView
      className="flex-1 bg-ink"
      contentContainerClassName="gap-4 p-5 pb-16"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          tintColor={brand.gold}
          onRefresh={() => void query.refetch()}
        />
      }
    >
      <View className="gap-2">
        <View className={`self-start rounded-full px-3 py-1 ${statusColour[alert.status]}`}>
          <Text className="text-xs font-bold uppercase tracking-widest text-white">
            {SOS_STATUS_LABELS[alert.status]}
          </Text>
        </View>
        <Text className="text-3xl font-black text-white">SOS: {alert.officer_name}</Text>
        <Text className="text-base text-white/70">
          {alert.site_name ?? 'Site unknown'} · raised{' '}
          {new Date(alert.triggered_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>

      <Card>
        <View className="gap-3">
          <View className="flex-row items-start gap-2">
            <Ionicons name="location" size={20} color={brand.gold} />
            <Text className="flex-1 text-sm leading-5 text-white/90">
              {alert.latitude !== null && alert.longitude !== null
                ? `Last position${alert.accuracy_m ? ` (within ${Math.round(alert.accuracy_m)} m)` : ''}${
                    alert.location_at
                      ? ` at ${new Date(alert.location_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : ''
                  }`
                : 'No position from the phone yet.'}
            </Text>
          </View>
          {alert.latitude !== null && alert.longitude !== null ? (
            <Button
              title="Open in Maps"
              variant="secondary"
              onPress={() => void Linking.openURL(mapLink(alert.latitude!, alert.longitude!))}
            />
          ) : null}
          {alert.officer_phone ? (
            <Button
              title={`Call ${alert.officer_name}`}
              onPress={() => void Linking.openURL(`tel:${alert.officer_phone}`)}
            />
          ) : null}
        </View>
      </Card>

      {alert.acknowledged_by_name ? (
        <Text className="text-sm text-white/70">
          Acknowledged by {alert.acknowledged_by_name}
          {alert.acknowledge_notes ? `: ${alert.acknowledge_notes}` : ''}
        </Text>
      ) : null}
      {!open ? (
        <Text className="text-sm text-white/70">
          Closed by {alert.resolved_by_name ?? 'staff'}: {alert.resolution_notes}
        </Text>
      ) : (
        <View className="gap-3">
          <Input
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={2000}
            placeholder={
              alert.status === 'active' ? 'Optional: e.g. driving over' : 'Required to resolve'
            }
          />
          {actionError ? <Notice tone="error">{actionError}</Notice> : null}
          {alert.status === 'active' ? (
            <Button title="Acknowledge" loading={busy} onPress={() => void acknowledge()} />
          ) : null}
          <Button
            title="Resolve"
            variant="secondary"
            loading={busy}
            onPress={() => void resolve('resolved')}
          />
          <Button
            title="False alarm"
            variant="secondary"
            loading={busy}
            onPress={() => void resolve('false_alarm')}
          />
        </View>
      )}
    </ScrollView>
  );
}
