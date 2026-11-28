import { QUESTION_TYPE_LABELS, recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { Badge, Card, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { formatWhen } from '../../../../forms/format';
import { getTimeZone } from '../../../../schedule/data';
import { loadLesson } from '../../../data';
import { formatDuration, formatScore } from '../../../labels';
import { loadFailed } from '@/lib/server-errors';

type Props = PageProps<'/training/[id]/attempts/[attemptId]'>;

const paramsSchema = z.object({ id: z.uuid(), attemptId: z.uuid() });

export default function AttemptPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-slate-500">Loading attempt…</p>}>
        <AttemptContent params={params} />
      </Suspense>
    </div>
  );
}

async function AttemptContent({ params }: Pick<Props, 'params'>) {
  await requireStaff();
  const p = paramsSchema.safeParse(await params);
  if (!p.success || !recordIdSchema.safeParse({ id: p.data.id }).success) notFound();
  const supabase = await createClient();

  // RLS: admins see every attempt, supervisors only their sites' officers.
  const { data: attempt, error } = await supabase
    .from('assessment_attempts')
    .select('*, officer:profiles!assessment_attempts_officer_id_fkey(full_name)')
    .eq('id', p.data.attemptId)
    .maybeSingle();
  if (error) return <ErrorText>{loadFailed('the attempt', error)}</ErrorText>;
  if (!attempt) notFound();

  const [loaded, others, timeZone] = await Promise.all([
    loadLesson(supabase, p.data.id),
    supabase
      .from('assessment_attempts')
      .select('id, attempt_number, score_percent, passed, submitted_at, timed_out')
      .eq('assessment_id', attempt.assessment_id)
      .eq('officer_id', attempt.officer_id)
      .order('attempt_number'),
    getTimeZone(supabase),
  ]);
  if (!loaded || loaded.assessment?.id !== attempt.assessment_id) notFound();

  const answers = (attempt.answers ?? {}) as Record<string, string[]>;
  const answeredIds = new Set(Object.keys(answers));
  const known = new Set(loaded.questions.map((q) => q.id));
  const missing = [...answeredIds].filter((id) => !known.has(id)).length;
  const duration =
    attempt.submitted_at !== null
      ? Math.round((Date.parse(attempt.submitted_at) - Date.parse(attempt.started_at)) / 1000)
      : null;

  return (
    <>
      <Link
        href={`/training/${p.data.id}?tab=results`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← Results: {loaded.lesson.title}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">
          {attempt.officer?.full_name ?? 'Officer'} · attempt {attempt.attempt_number}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {attempt.submitted_at === null ? (
            <Badge tone="warn">In progress</Badge>
          ) : (
            <Badge tone={attempt.passed ? 'good' : 'bad'}>
              {attempt.passed ? 'Passed' : 'Failed'} · {formatScore(attempt.score_percent)}
            </Badge>
          )}
          {attempt.timed_out ? <Badge tone="bad">Over the time limit</Badge> : null}
          <span>Started {formatWhen(attempt.started_at, timeZone)}</span>
          {duration !== null ? <span>· took {formatDuration(duration)}</span> : null}
        </div>
        {(others.data?.length ?? 0) > 1 ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {others.data!.map((o) => (
              <Link
                key={o.id}
                href={`/training/${p.data.id}/attempts/${o.id}`}
                aria-current={o.id === attempt.id ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 ${o.id === attempt.id ? 'border-gold bg-gold/15' : 'border-line hover:bg-surface-2'}`}
              >
                #{o.attempt_number} {o.submitted_at ? formatScore(o.score_percent) : '…'}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {missing > 0 ? (
        <p className="text-sm text-muted">
          {missing} answer{missing === 1 ? '' : 's'} belong to questions that were deleted since.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {loaded.questions.map((q, i) => {
          const chosen = new Set(answers[q.id] ?? []);
          const key = q.options.filter((o) => o.is_correct).map((o) => o.id);
          const right =
            chosen.size > 0 && chosen.size === key.length && key.every((id) => chosen.has(id));
          return (
            <Card key={q.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    {i + 1}. {QUESTION_TYPE_LABELS[q.type]} · {q.points} point
                    {q.points === 1 ? '' : 's'}
                  </span>
                  <span className="font-medium whitespace-pre-wrap">{q.prompt}</span>
                </div>
                <Badge tone={chosen.size === 0 ? 'neutral' : right ? 'good' : 'bad'}>
                  {chosen.size === 0 ? 'Not answered' : right ? 'Right' : 'Wrong'}
                </Badge>
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {q.options.map((o) => {
                  const picked = chosen.has(o.id);
                  return (
                    <li
                      key={o.id}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                        picked
                          ? o.is_correct
                            ? 'border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/40'
                            : 'border-red-400/60 bg-red-50 dark:bg-red-950/40'
                          : 'border-line'
                      }`}
                    >
                      <span className="w-5 text-center">{picked ? '●' : '○'}</span>
                      <span className="flex-1">{o.text}</span>
                      {o.is_correct ? (
                        <span className="text-xs text-emerald-700 dark:text-emerald-400">
                          correct
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {q.explanation ? (
                <p className="mt-2 text-xs text-muted">Explanation: {q.explanation}</p>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
