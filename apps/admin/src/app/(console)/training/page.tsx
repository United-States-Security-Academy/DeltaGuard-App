import Link from 'next/link';
import { Suspense } from 'react';

import { Badge, type BadgeTone, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadFailed } from '@/lib/server-errors';

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'warn',
  published: 'good',
  archived: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export default function TrainingPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-slate-500">Loading training…</p>}>
        <TrainingContent />
      </Suspense>
    </div>
  );
}

async function TrainingContent() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lessons')
    .select(
      `id, title, status, version, page_count, estimated_minutes,
       assessments(id, questions(count)), lesson_assignments(count)`,
    )
    .order('status')
    .order('title');

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Training</h1>
        {staff.role === 'admin' ? (
          <Link
            href="/training/new"
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-navy dark:bg-gold dark:text-ink"
          >
            New lesson
          </Link>
        ) : null}
      </div>
      {error ? (
        <ErrorText>{loadFailed('lessons', error)}</ErrorText>
      ) : data.length === 0 ? (
        <EmptyState>
          {staff.role === 'admin'
            ? 'No lessons yet. Upload a PDF to create one.'
            : 'No published lessons yet.'}
        </EmptyState>
      ) : (
        <Table head={['Lesson', 'Status', 'Version', 'Pages', 'Length', 'Quiz', 'Assignments']}>
          {data.map((l) => {
            const quiz = l.assessments;
            return (
              <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                <td className="px-3 py-3">
                  <Link href={`/training/${l.id}`} className="font-medium hover:underline">
                    {l.title}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                </td>
                <td className="px-3 py-3">v{l.version}</td>
                <td className="px-3 py-3">{l.page_count ?? '—'}</td>
                <td className="px-3 py-3">
                  {l.estimated_minutes ? `${l.estimated_minutes} min` : '—'}
                </td>
                <td className="px-3 py-3">
                  {quiz ? `${quiz.questions[0]?.count ?? 0} questions` : 'No quiz'}
                </td>
                <td className="px-3 py-3">{l.lesson_assignments[0]?.count ?? 0}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
