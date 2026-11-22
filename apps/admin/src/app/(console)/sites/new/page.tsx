import { firstParam } from '@deltaguard/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';

import { Card, EmptyState } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { fallbackMapCenter } from '../data';
import { EMPTY_SITE, SiteForm } from '../site-form';

export default function NewSitePage({ searchParams }: PageProps<'/sites/new'>) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/sites" className="text-sm text-slate-500 hover:underline">
        ← All sites
      </Link>
      <h1 className="text-2xl font-bold">New site</h1>
      <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
        <NewSiteContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewSiteContent({
  searchParams,
}: {
  searchParams: PageProps<'/sites/new'>['searchParams'];
}) {
  await requireAdmin();
  // ?client=<id> preselects the client (from a client's page).
  const preselected = z
    .preprocess(firstParam, z.uuid())
    .catch('')
    .parse((await searchParams).client);

  const supabase = await createClient();
  const [clients, center] = await Promise.all([
    supabase.from('clients').select('id, name').order('name'),
    fallbackMapCenter(supabase),
  ]);
  const list = clients.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState>
        Add a client first: every site belongs to one.{' '}
        <Link href="/clients" className="underline">
          Go to Clients
        </Link>
      </EmptyState>
    );
  }

  return (
    <Card>
      <SiteForm
        values={{
          ...EMPTY_SITE,
          clientId: list.some((c) => c.id === preselected) ? preselected : '',
        }}
        clients={list}
        fallbackCenter={center}
      />
    </Card>
  );
}
