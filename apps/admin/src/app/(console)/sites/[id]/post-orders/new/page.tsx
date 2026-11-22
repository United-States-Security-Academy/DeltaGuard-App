import { recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Card, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { PostOrderForm } from '../post-order-form';

type Props = PageProps<'/sites/[id]/post-orders/new'>;

export default function NewPostOrderPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
        <NewPostOrderContent params={params} />
      </Suspense>
    </div>
  );
}

async function NewPostOrderContent({ params }: Pick<Props, 'params'>) {
  await requireStaff();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();

  const supabase = await createClient();
  const { data: site, error } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', id.data.id)
    .maybeSingle();
  if (error) return <ErrorText>Could not load this site: {error.message}</ErrorText>;
  if (!site) notFound();

  return (
    <>
      <Link href={`/sites/${site.id}`} className="text-sm text-slate-500 hover:underline">
        ← {site.name}
      </Link>
      <h1 className="text-2xl font-bold">New post order</h1>
      <p className="text-sm text-slate-500">
        Officers assigned to {site.name} must read and acknowledge it before they can clock in.
      </p>
      <Card>
        <PostOrderForm values={{ siteId: site.id, title: '', body: '' }} />
      </Card>
    </>
  );
}
