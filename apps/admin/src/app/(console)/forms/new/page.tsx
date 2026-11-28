import Link from 'next/link';
import { Suspense } from 'react';

import { Card } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';

import { NewFormForm } from './new-form';

export default function NewFormPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Link href="/forms" className="text-sm text-slate-500 hover:underline">
        ← Forms
      </Link>
      <h1 className="text-2xl font-bold">New form</h1>
      <Suspense fallback={null}>
        <Gate />
      </Suspense>
    </div>
  );
}

async function Gate() {
  await requireAdmin();
  return (
    <Card>
      <p className="mb-4 text-sm text-muted">
        Upload the PDF form your officers fill in. Its pages are turned into images in your browser,
        and any fillable fields in the PDF are placed for you. You can then add, move and adjust
        fields before publishing.
      </p>
      <NewFormForm />
    </Card>
  );
}
