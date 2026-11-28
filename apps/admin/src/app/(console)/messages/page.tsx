import { firstParam } from '@deltaguard/shared';
import { Suspense } from 'react';
import { z } from 'zod';

import { ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { MessagesApp } from './messages-app';
import { loadFailed } from '@/lib/server-errors';

const paramsSchema = z.object({
  c: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
});

export default function MessagesPage({ searchParams }: PageProps<'/messages'>) {
  return (
    <Suspense fallback={<div className="h-[calc(100dvh-9rem)] animate-pulse panel" />}>
      <Messages searchParams={searchParams} />
    </Suspense>
  );
}

async function Messages({
  searchParams,
}: {
  searchParams: PageProps<'/messages'>['searchParams'];
}) {
  const staff = await requireStaff();
  const { c } = paramsSchema.parse(await searchParams);
  const supabase = await createClient();
  // Sites, for "group per site". Everything else loads in the browser with the
  // staff member's own session (RLS: members only) and stays live via Realtime.
  const sites = await supabase.from('sites').select('id, name').order('name');
  if (sites.error) return <ErrorText>{loadFailed('sites', sites.error)}</ErrorText>;

  return <MessagesApp userId={staff.userId} sites={sites.data} initialConversationId={c ?? null} />;
}
