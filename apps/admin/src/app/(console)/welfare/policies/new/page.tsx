import Link from 'next/link';
import { Suspense } from 'react';

import { Card } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';

import { PolicyForm } from '../forms';
import { NEW_POLICY } from '../policy-values';

export default function NewWelfarePolicyPage() {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/welfare/policies" className="text-sm text-muted hover:underline">
        ← Welfare policies
      </Link>
      <h1 className="text-2xl font-bold">New welfare policy</h1>
      <Suspense fallback={null}>
        <NewPolicy />
      </Suspense>
    </div>
  );
}

async function NewPolicy() {
  await requireAdmin();
  return (
    <Card>
      <PolicyForm values={NEW_POLICY} />
    </Card>
  );
}
