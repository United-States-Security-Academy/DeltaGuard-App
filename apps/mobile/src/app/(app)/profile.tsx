import { describeExpiry, expiryStatus, formatDate, todayIso } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import {
  Body,
  Button,
  Card,
  ErrorState,
  InfoRow,
  Notice,
  SectionTitle,
  Title,
} from '@/components/ui';
import { getOrCreateDeviceId } from '@/lib/device';
import { openLicenceScan, useMyDetails, useMyQualifications } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { brand } from '@/lib/theme';

export default function ProfileScreen() {
  const { state, signOut } = useSession();
  if (state.status !== 'ready') return null;
  return (
    <Profile
      userId={state.profile.id}
      fullName={state.profile.fullName}
      role={state.profile.role}
      email={state.email}
      onSignOut={() => void signOut()}
    />
  );
}

function Profile({
  userId,
  fullName,
  role,
  email,
  onSignOut,
}: {
  userId: string;
  fullName: string | null;
  role: string;
  email: string | undefined;
  onSignOut: () => void;
}) {
  const details = useMyDetails(userId);
  const qualifications = useMyQualifications(userId);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    void getOrCreateDeviceId().then(setDeviceId);
  }, []);

  const refreshing = details.isRefetching || qualifications.isRefetching;

  return (
    <ScrollView
      className="flex-1 bg-ink"
      contentContainerClassName="gap-4 p-5 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void details.refetch();
            void qualifications.refetch();
          }}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      <View className="gap-1">
        <Title>{fullName ?? 'Your profile'}</Title>
        <Text className="text-sm capitalize text-gold">{role}</Text>
        {email ? <Text className="text-sm text-white/60">{email}</Text> : null}
      </View>

      <SectionTitle>My details</SectionTitle>
      {details.isPending ? (
        <ActivityIndicator color={brand.gold} />
      ) : details.isError ? (
        <ErrorState
          message="Couldn't load your details."
          onRetry={() => void details.refetch()}
          error={details.error}
        />
      ) : (
        <Card>
          <InfoRow label="Employee number" value={details.data.employeeNumber ?? '—'} />
          <InfoRow label="Phone" value={details.data.phone ?? '—'} />
          <InfoRow label="Date hired" value={formatDate(details.data.dateHired)} />
          <InfoRow label="Home address" value={details.data.address ?? '—'} />
          <InfoRow
            label="Emergency contact"
            value={
              details.data.emergencyContact
                ? `${details.data.emergencyContact.name}${
                    details.data.emergencyContact.relationship
                      ? ` (${details.data.emergencyContact.relationship})`
                      : ''
                  }\n${details.data.emergencyContact.phone}`
                : '—'
            }
          />
          <Text className="text-xs text-white/40">
            Something wrong? Ask an administrator to update it.
          </Text>
        </Card>
      )}

      <SectionTitle>Licences and qualifications</SectionTitle>
      {qualifications.isPending ? (
        <ActivityIndicator color={brand.gold} />
      ) : qualifications.isError ? (
        <ErrorState
          message="Couldn't load your qualifications."
          onRetry={() => void qualifications.refetch()}
          error={qualifications.error}
        />
      ) : qualifications.data.length === 0 ? (
        <Body>No licences or certificates recorded yet.</Body>
      ) : (
        <Qualifications items={qualifications.data} />
      )}

      <SectionTitle>This phone</SectionTitle>
      <Card>
        {/* Shown so an admin can confirm which phone is registered. */}
        <InfoRow label="Device ID" value={deviceId ? `${deviceId.slice(0, 8)}…` : '…'} />
      </Card>

      <Button title="Sign out" variant="secondary" onPress={onSignOut} />
    </ScrollView>
  );
}

type Qualification = {
  id: string;
  type: string;
  license_number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  document_path: string | null;
};

function Qualifications({ items }: { items: Qualification[] }) {
  const today = todayIso();
  const [scanError, setScanError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const needsAttention = items.filter((q) => {
    const kind = expiryStatus(q.expires_on, today).kind;
    return kind === 'expired' || kind === 'expiring';
  }).length;

  return (
    <View className="gap-3">
      {needsAttention > 0 ? (
        <Notice tone="info">
          {needsAttention === 1
            ? '1 licence needs renewing soon. Tell your supervisor once it is renewed.'
            : `${needsAttention} licences need renewing soon. Tell your supervisor once they are renewed.`}
        </Notice>
      ) : null}

      {items.map((q) => {
        const status = expiryStatus(q.expires_on, today);
        const expired = status.kind === 'expired';
        const expiring = status.kind === 'expiring';
        return (
          <Card key={q.id} tone={expired ? 'danger' : expiring ? 'warn' : 'default'}>
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-base font-bold text-white">{q.type}</Text>
              {expired || expiring ? (
                <View
                  className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${
                    expired ? 'bg-red-500/20' : 'bg-gold'
                  }`}
                >
                  <Ionicons
                    name={expired ? 'close-circle' : 'warning'}
                    size={12}
                    color={expired ? '#fca5a5' : brand.ink}
                  />
                  <Text className={`text-xs font-bold ${expired ? 'text-red-200' : 'text-ink'}`}>
                    {expired ? 'Expired' : 'Expiring soon'}
                  </Text>
                </View>
              ) : null}
            </View>

            {q.license_number ? <InfoRow label="Licence number" value={q.license_number} /> : null}
            <View className="flex-row gap-6">
              <InfoRow label="Issued" value={formatDate(q.issued_on)} />
              <InfoRow label="Expires" value={formatDate(q.expires_on)} />
            </View>
            <Text
              className={`text-sm font-semibold ${
                expired ? 'text-red-300' : expiring ? 'text-gold' : 'text-white/60'
              }`}
            >
              {describeExpiry(status)}
            </Text>

            {q.document_path ? (
              <Pressable
                accessibilityRole="button"
                disabled={opening !== null}
                onPress={async () => {
                  setScanError(null);
                  setOpening(q.id);
                  const error = await openLicenceScan(q.document_path!);
                  setOpening(null);
                  if (error) setScanError(error);
                }}
                className="flex-row items-center gap-2 self-start py-1 active:opacity-70"
              >
                <Ionicons name="document-attach-outline" size={16} color={brand.gold} />
                <Text className="text-sm font-semibold text-gold">
                  {opening === q.id ? 'Opening…' : 'View scan'}
                </Text>
              </Pressable>
            ) : null}
          </Card>
        );
      })}

      {scanError ? <Notice tone="error">{scanError}</Notice> : null}
    </View>
  );
}
