import { firstParam, LESSON_FILES_BUCKET, recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { ActionButton } from '@/components/action-form';
import { Badge, type BadgeTone, Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { PAGE_IMAGE_URL_SECONDS, signPaths } from '../../forms/data';
import { formatWhen } from '../../forms/format';
import { getTimeZone } from '../../schedule/data';
import { deleteDraftLesson, deleteLessonAssignment, setLessonStatus } from '../actions';
import { type LoadedLesson, loadLesson } from '../data';
import {
  formatDuration,
  formatScore,
  RESULT_STATUS_LABELS,
  RESULT_STATUS_TONES,
  type ResultStatus,
} from '../labels';
import { AssignLessonForm, GrantAttemptButton } from './assign-lesson';
import { LessonDetailsForm, LessonPdfUpload } from './lesson-panel';
import { QuestionBuilder } from './question-builder';
import { QuizSettingsForm } from './quiz-settings';
import { caughtMessage, loadFailed } from '@/lib/server-errors';

type Props = PageProps<'/training/[id]'>;

const TABS = ['lesson', 'quiz', 'assign', 'results'] as const;
const TAB_LABELS = {
  lesson: 'Lesson',
  quiz: 'Quiz',
  assign: 'Assign',
  results: 'Results',
} as const;
const tabSchema = z.preprocess(firstParam, z.enum(TABS)).catch('lesson');

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'warn',
  published: 'good',
  archived: 'neutral',
};

export default function LessonPage({ params, searchParams }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/training" className="text-sm text-slate-500 hover:underline">
        ← Training
      </Link>
      <Suspense fallback={<p className="text-slate-500">Loading lesson…</p>}>
        <LessonContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LessonContent({ params, searchParams }: Props) {
  const staff = await requireStaff();
  const isAdmin = staff.role === 'admin';
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();
  const query = await searchParams;
  const tab = tabSchema.parse(query.tab);

  const supabase = await createClient();
  let loaded;
  try {
    loaded = await loadLesson(supabase, id.data.id);
  } catch (e) {
    return <ErrorText>{caughtMessage(e, 'this lesson')}</ErrorText>;
  }
  if (!loaded) notFound();
  const { lesson, assessment } = loaded;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{lesson.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={STATUS_TONE[lesson.status]}>
              {lesson.status === 'draft'
                ? 'Draft'
                : lesson.status === 'published'
                  ? 'Published'
                  : 'Archived'}
            </Badge>
            <span>Version {lesson.version}</span>
            {lesson.page_count ? <span>· {lesson.page_count} pages</span> : null}
            {lesson.estimated_minutes ? <span>· about {lesson.estimated_minutes} min</span> : null}
          </div>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            {lesson.status !== 'published' ? (
              <ActionButton
                action={setLessonStatus}
                fields={{ id: lesson.id, status: 'published' }}
                label={lesson.status === 'archived' ? 'Restore' : 'Publish'}
                variant="primary"
              />
            ) : (
              <ActionButton
                action={setLessonStatus}
                fields={{ id: lesson.id, status: 'archived' }}
                label="Archive"
                confirm="Archive this lesson? Officers stop seeing it; results are kept."
              />
            )}
            {lesson.status === 'draft' ? (
              <ActionButton
                action={deleteDraftLesson}
                fields={{ id: lesson.id }}
                label="Delete draft"
                variant="danger"
                confirm="Delete this draft lesson and its files?"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {query.upload_error ? (
        <ErrorText>The PDF could not be uploaded. Try again with “Upload PDF”.</ErrorText>
      ) : null}

      <nav className="flex gap-1 border-b border-line text-sm" aria-label="Lesson sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === 'lesson' ? `/training/${lesson.id}` : `/training/${lesson.id}?tab=${t}`}
            aria-current={tab === t ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${tab === t ? 'border-gold text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {TAB_LABELS[t]}
            {t === 'quiz' && assessment ? ` (${loaded.questions.length})` : ''}
            {t === 'assign' ? ` (${loaded.assignments.length})` : ''}
          </Link>
        ))}
      </nav>

      {tab === 'lesson' ? (
        <LessonTab loaded={loaded} isAdmin={isAdmin} />
      ) : tab === 'quiz' ? (
        <QuizTab loaded={loaded} isAdmin={isAdmin} />
      ) : tab === 'assign' ? (
        <AssignTab loaded={loaded} isAdmin={isAdmin} />
      ) : (
        <ResultsTab loaded={loaded} isAdmin={isAdmin} />
      )}
    </>
  );
}

async function LessonTab({ loaded, isAdmin }: { loaded: LoadedLesson; isAdmin: boolean }) {
  await requireStaff(); // each data-loading component checks access itself
  const { lesson } = loaded;
  const supabase = await createClient();
  const pages = await signPaths(
    supabase,
    LESSON_FILES_BUCKET,
    lesson.page_image_paths,
    PAGE_IMAGE_URL_SECONDS,
  );
  return (
    <div className="flex flex-col gap-6">
      {isAdmin && lesson.status !== 'archived' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Details">
            <LessonDetailsForm
              id={lesson.id}
              title={lesson.title}
              description={lesson.description}
              estimatedMinutes={lesson.estimated_minutes}
            />
          </Card>
          <Card title="PDF">
            <p className="mb-3 text-sm text-muted">
              Pages are rendered in your browser and shown to officers one page at a time. Officers
              must view every page before the quiz opens.
            </p>
            <LessonPdfUpload
              lessonId={lesson.id}
              hasPdf={lesson.pdf_path !== null}
              published={lesson.status === 'published'}
            />
          </Card>
        </div>
      ) : lesson.description ? (
        <p className="max-w-2xl text-sm text-muted">{lesson.description}</p>
      ) : null}
      {pages.length === 0 ? (
        <EmptyState>No PDF yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pages.map((url, i) => (
            <figure key={i} className="flex flex-col gap-1">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
                <img
                  src={url}
                  alt={`Page ${i + 1}`}
                  className="w-full rounded-lg border border-line bg-white"
                />
              ) : null}
              <figcaption className="text-center text-xs text-muted">Page {i + 1}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function QuizTab({ loaded, isAdmin }: { loaded: LoadedLesson; isAdmin: boolean }) {
  const { lesson, assessment, questions } = loaded;
  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? (
        <Card title={assessment ? 'Quiz settings' : 'Quiz'}>
          {!assessment ? (
            <p className="mb-4 text-sm text-muted">
              This lesson has no quiz: officers complete it by reading every page. Add a quiz to
              test them.
            </p>
          ) : null}
          <QuizSettingsForm
            lessonId={lesson.id}
            settings={assessment}
            exists={assessment !== null}
          />
        </Card>
      ) : assessment ? (
        <Card title="Quiz settings">
          <p className="text-sm">
            Pass mark {assessment.pass_mark_percent}% · attempts{' '}
            {assessment.max_attempts ?? 'unlimited'} · time limit{' '}
            {assessment.time_limit_minutes ? `${assessment.time_limit_minutes} min` : 'none'}
          </p>
        </Card>
      ) : (
        <EmptyState>This lesson has no quiz.</EmptyState>
      )}
      {assessment && isAdmin ? (
        <QuestionBuilder
          key={questions.map((q) => q.id).join()}
          assessmentId={assessment.id}
          questions={questions}
          attemptCount={loaded.attemptCount}
          shuffleQuestions={assessment.shuffle_questions}
          shuffleOptions={assessment.shuffle_options}
          passMark={assessment.pass_mark_percent}
        />
      ) : assessment ? (
        <ol className="flex flex-col gap-2 text-sm">
          {questions.map((q, i) => (
            <li key={q.id} className="panel p-4">
              {i + 1}. {q.prompt}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

async function AssignTab({ loaded, isAdmin }: { loaded: LoadedLesson; isAdmin: boolean }) {
  await requireStaff(); // each data-loading component checks access itself
  const { lesson, assignments } = loaded;
  const supabase = await createClient();
  const [officers, sites, quals, timeZone] = await Promise.all([
    isAdmin
      ? supabase
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'officer')
          .eq('employment_status', 'active')
          .order('full_name')
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    isAdmin
      ? supabase.from('sites').select('id, name').eq('active', true).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    isAdmin
      ? supabase.from('qualifications').select('type').limit(1000)
      : Promise.resolve({ data: [] }),
    getTimeZone(supabase),
  ]);
  const qualificationTypes = [
    ...new Set((quals.data ?? []).map((q: { type: string }) => q.type)),
  ].sort();
  const now = new Date().getTime();

  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? (
        <Card title="Assign">
          {lesson.status === 'published' ? (
            <AssignLessonForm
              lessonId={lesson.id}
              officers={(officers.data ?? []).map((o) => ({
                value: o.id,
                label: o.full_name ?? 'Unnamed',
              }))}
              sites={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              qualificationTypes={qualificationTypes}
            />
          ) : (
            <p className="text-sm text-muted">Publish the lesson before assigning it.</p>
          )}
        </Card>
      ) : null}
      {assignments.length === 0 ? (
        <EmptyState>Not assigned to anyone yet.</EmptyState>
      ) : (
        <Table
          head={[
            'Assigned to',
            'Due',
            'Qualification on passing',
            'Assigned',
            ...(isAdmin ? [''] : []),
          ]}
        >
          {assignments.map((a) => (
            <tr key={a.id}>
              <td className="px-3 py-3 font-medium">
                {a.officer_id
                  ? (a.officer?.full_name ?? 'Officer')
                  : a.site_id
                    ? `Everyone at ${a.sites?.name ?? 'a site'}`
                    : `All ${a.role}s`}
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                {a.due_at ? (
                  <span className="flex items-center gap-2">
                    {formatWhen(a.due_at, timeZone)}
                    {Date.parse(a.due_at) < now ? <Badge tone="bad">Past due</Badge> : null}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-3">
                {a.creates_qualification_type
                  ? `${a.creates_qualification_type}${a.qualification_valid_months ? ` (${a.qualification_valid_months} months)` : ' (no expiry)'}`
                  : '—'}
              </td>
              <td className="px-3 py-3 whitespace-nowrap">{formatWhen(a.created_at, timeZone)}</td>
              {isAdmin ? (
                <td className="px-3 py-3">
                  <ActionButton
                    action={deleteLessonAssignment}
                    fields={{ id: a.id }}
                    label="Remove"
                    confirm="Remove this assignment? Progress and results are kept."
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

async function ResultsTab({ loaded, isAdmin }: { loaded: LoadedLesson; isAdmin: boolean }) {
  await requireStaff(); // each data-loading component checks access itself
  const { lesson, assessment } = loaded;
  const supabase = await createClient();
  const [results, stats, timeZone] = await Promise.all([
    supabase.rpc('lesson_results', { p_lesson_id: lesson.id }),
    supabase.rpc('lesson_question_stats', { p_lesson_id: lesson.id }),
    getTimeZone(supabase),
  ]);
  if (results.error) return <ErrorText>{loadFailed('results', results.error)}</ErrorText>;
  const rows = results.data;
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    if (r.overdue) acc.overdue = (acc.overdue ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          {(['passed', 'failed', 'ready_for_quiz', 'reading', 'not_started'] as const).map((s) => (
            <Badge key={s} tone={RESULT_STATUS_TONES[s]}>
              {RESULT_STATUS_LABELS[s]}: {counts[s] ?? 0}
            </Badge>
          ))}
          <Badge tone="bad">Overdue: {counts.overdue ?? 0}</Badge>
        </div>
        <a
          href={`/training/${lesson.id}/export`}
          className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
        >
          Export CSV
        </a>
      </div>

      {rows.length === 0 ? (
        <EmptyState>Nobody is assigned this lesson yet.</EmptyState>
      ) : (
        <Table
          head={[
            'Officer',
            'Status',
            'Due',
            'Reading',
            'Time reading',
            'Attempts',
            'Best score',
            'Passed',
            '',
          ]}
        >
          {rows.map((r) => {
            const status = r.status as ResultStatus;
            const canGrant =
              isAdmin &&
              assessment?.max_attempts != null &&
              status !== 'passed' &&
              r.attempts_allowed !== null &&
              r.attempts >= r.attempts_allowed;
            return (
              <tr key={r.officer_id}>
                <td className="px-3 py-3 font-medium">{r.officer_name ?? '—'}</td>
                <td className="px-3 py-3">
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone={RESULT_STATUS_TONES[status]}>{RESULT_STATUS_LABELS[status]}</Badge>
                    {r.overdue ? <Badge tone="bad">Overdue</Badge> : null}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{formatWhen(r.due_at, timeZone)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {r.page_count
                    ? `${Math.min(r.pages_viewed, r.page_count)} / ${r.page_count} pages`
                    : '—'}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{formatDuration(r.seconds_spent)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {assessment ? `${r.attempts} / ${r.attempts_allowed ?? '∞'}` : '—'}
                </td>
                <td className="px-3 py-3">{formatScore(r.best_score)}</td>
                <td className="px-3 py-3 whitespace-nowrap">{formatWhen(r.passed_at, timeZone)}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    {r.last_attempt_id ? (
                      <Link
                        href={`/training/${lesson.id}/attempts/${r.last_attempt_id}`}
                        className="text-xs text-muted hover:underline"
                      >
                        Answers →
                      </Link>
                    ) : null}
                    {canGrant && assessment ? (
                      <GrantAttemptButton assessmentId={assessment.id} officerId={r.officer_id} />
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {assessment ? (
        <Card title="Questions most often wrong">
          {!stats.data?.length || stats.data.every((s) => s.attempts === 0) ? (
            <p className="text-sm text-muted">No submitted attempts yet.</p>
          ) : (
            <Table head={['Question', 'Attempts', 'Right', 'Wrong']}>
              {stats.data.map((s) => (
                <tr key={s.question_id}>
                  <td className="max-w-xl px-3 py-3">{s.prompt}</td>
                  <td className="px-3 py-3">{s.attempts}</td>
                  <td className="px-3 py-3">{s.correct}</td>
                  <td className="px-3 py-3">
                    {s.wrong_percent === null ? (
                      '—'
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-24 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className="block h-full bg-red-500"
                            style={{ width: `${Number(s.wrong_percent)}%` }}
                          />
                        </span>
                        {formatScore(s.wrong_percent)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted">
            Counts every submitted attempt (not timed-out ones); an unanswered question counts as
            wrong.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
