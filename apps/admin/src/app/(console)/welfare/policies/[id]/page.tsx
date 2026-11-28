import { recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Card, ErrorText } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { DeletePolicyButton, PolicyForm } from '../forms';
import { loadFailed } from '@/lib/server-errors';

export default function WelfarePolicyPage({ params }: PageProps<'/welfare/policies/[id]'>) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/welfare/policies" className="text-sm text-muted hover:underline">
        ← Welfare policies
      </Link>
      <Suspense fallback={<p className="text-muted">Loading the policy…</p>}>
        <EditPolicy params={params} />
      </Suspense>
    </div>
  );
}

async function EditPolicy({ params }: { params: PageProps<'/welfare/policies/[id]'>['params'] }) {
  await requireAdmin();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('welfare_check_policies')
    .select('*')
    .eq('id', id.data.id)
    .maybeSingle();
  if (error) return <ErrorText>{loadFailed('the policy', error)}</ErrorText>;
  if (!data) notFound();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">{data.name}</h1>
        <DeletePolicyButton id={data.id} name={data.name} />
      </div>
      <Card>
        <PolicyForm
          values={{
            id: data.id,
            name: data.name,
            min_interval_minutes: data.min_interval_minutes,
            max_interval_minutes: data.max_interval_minutes,
            night_start: data.night_start,
            night_end: data.night_end,
            night_min_interval_minutes: data.night_min_interval_minutes,
            night_max_interval_minutes: data.night_max_interval_minutes,
            response_seconds: data.response_seconds,
            alarm_seconds: data.alarm_seconds,
            call_attempts: data.call_attempts,
            call_gap_seconds: data.call_gap_seconds,
            supervisor_alert_after_seconds: data.supervisor_alert_after_seconds,
            enabled: data.enabled,
          }}
        />
      </Card>
    </>
  );
}
