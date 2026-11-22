import { firstParam, isoDateSchema, todayInZone } from '@deltaguard/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';

import { Card } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone, loadFormOptions } from '../data';
import { ShiftForm } from '../shift-form';

// Prefilled from the week grid's "+" buttons: ?site=…|officer=…&date=…&view=…
const paramsSchema = z.object({
  site: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  officer: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  date: z.preprocess(firstParam, isoDateSchema.optional()).catch(undefined),
  view: z.preprocess(firstParam, z.enum(['site', 'officer'])).catch('site'),
});

export default function NewShiftPage({ searchParams }: PageProps<'/schedule/new'>) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/schedule" className="text-sm text-slate-500 hover:underline">
        ← Schedule
      </Link>
      <h1 className="text-2xl font-bold">Add shift</h1>
      <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
        <NewShiftContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewShiftContent({
  searchParams,
}: {
  searchParams: PageProps<'/schedule/new'>['searchParams'];
}) {
  await requireStaff();
  const params = paramsSchema.parse(await searchParams);
  const supabase = await createClient();
  const [timeZone, options] = await Promise.all([getTimeZone(supabase), loadFormOptions(supabase)]);

  return (
    <Card>
      <ShiftForm
        initial={{
          site_id: options.sites.some((s) => s.id === params.site) ? params.site! : '',
          officer_id: options.officers.some((o) => o.id === params.officer) ? params.officer! : '',
          date: params.date ?? todayInZone(timeZone),
          start_time: '07:00',
          end_time: '19:00',
          notes: '',
        }}
        sites={options.sites}
        officers={options.officers}
        assignments={options.assignments}
        view={params.view}
        timeZone={timeZone}
      />
    </Card>
  );
}
