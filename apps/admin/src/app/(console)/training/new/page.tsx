import Link from 'next/link';
import { Suspense } from 'react';

import { Card } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';

import { NewLessonForm } from './new-lesson';

export default function NewLessonPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Link href="/training" className="text-sm text-slate-500 hover:underline">
        ← Training
      </Link>
      <h1 className="text-2xl font-bold">New lesson</h1>
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
        Upload the lesson as a PDF. Its pages are turned into images in your browser so officers can
        read them page by page on their phone. You add the quiz next.
      </p>
      <NewLessonForm />
    </Card>
  );
}
