import { Suspense } from 'react';

import { Card, ErrorText } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { SettingsForm } from './settings-form';

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Suspense fallback={<p className="text-slate-500">Loading settings…</p>}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}

/** US zones first (Deltacon is in Texas), then every other zone the runtime knows. */
const US_ZONES: { value: string; label: string }[] = [
  { value: 'America/Chicago', label: 'Central (Texas) · America/Chicago' },
  { value: 'America/New_York', label: 'Eastern · America/New_York' },
  { value: 'America/Denver', label: 'Mountain · America/Denver' },
  { value: 'America/Phoenix', label: 'Arizona · America/Phoenix' },
  { value: 'America/Los_Angeles', label: 'Pacific · America/Los_Angeles' },
  { value: 'America/Anchorage', label: 'Alaska · America/Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii · Pacific/Honolulu' },
];

function zoneGroups(current: string) {
  const us = new Set(US_ZONES.map((z) => z.value));
  const others = Intl.supportedValuesOf('timeZone').filter((z) => !us.has(z));
  // Keep the saved value selectable even if this runtime doesn't list it.
  if (!us.has(current) && !others.includes(current)) others.unshift(current);
  return [
    { label: 'United States', zones: US_ZONES },
    {
      label: 'All time zones',
      zones: others.sort().map((z) => ({ value: z, label: z.replaceAll('_', ' ') })),
    },
  ];
}

async function SettingsContent() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .select('time_zone, late_grace_minutes, early_clock_in_minutes, low_accuracy_threshold_m')
    .maybeSingle();

  if (error) return <ErrorText>Could not load settings: {error.message}</ErrorText>;
  if (!data) return <ErrorText>The settings row is missing.</ErrorText>;

  return (
    <Card>
      <SettingsForm settings={data} zones={zoneGroups(data.time_zone)} />
    </Card>
  );
}
