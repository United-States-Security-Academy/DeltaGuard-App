import {
  attemptResultSchema,
  LESSON_FILES_BUCKET,
  type ShowAnswersAfter,
  SIGNED_URL_MAX_SECONDS,
} from '@deltaguard/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'react-native';

import { supabase } from './supabase';
import {
  cacheLesson,
  type CachedLesson,
  latestCachedLesson,
  readCachedLesson,
  type TrainingState,
} from './training-store';

export const trainingKeys = {
  all: ['training'] as const,
  mine: (userId: string) => ['training', 'mine', userId] as const,
  pages: (lessonId: string, version: number) => ['training', 'pages', lessonId, version] as const,
  overview: (assessmentId: string) => ['training', 'overview', assessmentId] as const,
};

export type MyLesson = {
  id: string;
  title: string;
  description: string | null;
  pageCount: number;
  estimatedMinutes: number | null;
  version: number;
  pageImagePaths: string[];
  dueAt: string | null;
  assessment: {
    id: string;
    passMark: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    showAnswers: ShowAnswersAfter;
  } | null;
  progress: { pagesViewed: number[]; secondsSpent: number; completedAt: string | null } | null;
  attempts: {
    id: string;
    number: number;
    score: number;
    passed: boolean;
    submittedAt: string;
    timedOut: boolean;
  }[];
  extraAttempts: number;
};

/** Published lessons assigned to me (RLS), with my progress, attempts and extra attempts. */
export function useMyTraining(userId: string) {
  return useQuery({
    queryKey: trainingKeys.mine(userId),
    queryFn: async (): Promise<MyLesson[]> => {
      const [lessons, progress, attempts, grants] = await Promise.all([
        supabase
          .from('lessons')
          .select(
            `id, title, description, page_count, estimated_minutes, version, page_image_paths,
             assessments(id, pass_mark_percent, max_attempts, time_limit_minutes, show_correct_answers_after),
             lesson_assignments(due_at)`,
          )
          .eq('status', 'published'),
        supabase
          .from('lesson_progress')
          .select('lesson_id, pages_viewed, seconds_spent, completed_reading_at')
          .eq('officer_id', userId),
        supabase
          .from('assessment_attempts')
          .select(
            'id, assessment_id, attempt_number, score_percent, passed, submitted_at, timed_out',
          )
          .eq('officer_id', userId)
          .not('submitted_at', 'is', null),
        supabase
          .from('assessment_attempt_grants')
          .select('assessment_id, extra_attempts')
          .eq('officer_id', userId),
      ]);
      if (lessons.error) throw lessons.error;
      if (progress.error) throw progress.error;
      if (attempts.error) throw attempts.error;

      return lessons.data.map((l) => {
        const a = l.assessments;
        const p = progress.data.find((x) => x.lesson_id === l.id);
        const dues = l.lesson_assignments
          .map((x) => x.due_at)
          .filter((d): d is string => !!d)
          .sort();
        return {
          id: l.id,
          title: l.title,
          description: l.description,
          pageCount: l.page_count ?? 0,
          estimatedMinutes: l.estimated_minutes,
          version: l.version,
          pageImagePaths: l.page_image_paths,
          dueAt: dues[0] ?? null,
          assessment: a
            ? {
                id: a.id,
                passMark: a.pass_mark_percent,
                maxAttempts: a.max_attempts,
                timeLimitMinutes: a.time_limit_minutes,
                showAnswers: a.show_correct_answers_after,
              }
            : null,
          progress: p
            ? {
                pagesViewed: p.pages_viewed,
                secondsSpent: p.seconds_spent,
                completedAt: p.completed_reading_at,
              }
            : null,
          attempts: a
            ? attempts.data
                .filter((t) => t.assessment_id === a.id)
                .map((t) => ({
                  id: t.id,
                  number: t.attempt_number,
                  score: Number(t.score_percent ?? 0),
                  passed: t.passed === true,
                  submittedAt: t.submitted_at!,
                  timedOut: t.timed_out,
                }))
                .sort((x, y) => x.number - y.number)
            : [],
          extraAttempts: a
            ? (grants.data ?? [])
                .filter((g) => g.assessment_id === a.id)
                .reduce((n, g) => n + g.extra_attempts, 0)
            : 0,
        };
      });
    },
  });
}

/** Pages seen, on the server and on this phone together. */
export function viewedPages(lesson: MyLesson, local: TrainingState): Set<number> {
  return new Set([
    ...(lesson.progress?.pagesViewed ?? []),
    ...(local.lessons[lesson.id]?.viewed ?? []),
  ]);
}

export function readingDone(lesson: MyLesson, local: TrainingState): boolean {
  if (lesson.progress?.completedAt) return true;
  const seen = viewedPages(lesson, local);
  return (
    lesson.pageCount > 0 &&
    Array.from({ length: lesson.pageCount }, (_, i) => i + 1).every((p) => seen.has(p))
  );
}

export type LessonState = {
  lesson: MyLesson;
  progress: number; // 0..1 of pages seen
  done: boolean; // in "Completed"
  passed: boolean;
  bestScore: number | null;
  attemptsLeft: number | null; // null = unlimited
  waitingToSubmit: boolean;
};

export function lessonState(lesson: MyLesson, local: TrainingState): LessonState {
  const seen = viewedPages(lesson, local).size;
  const progress = lesson.pageCount ? Math.min(1, seen / lesson.pageCount) : 0;
  const passed = lesson.assessment
    ? lesson.attempts.some((t) => t.passed)
    : readingDone(lesson, local);
  const allowed =
    lesson.assessment?.maxAttempts == null
      ? null
      : lesson.assessment.maxAttempts + lesson.extraAttempts;
  const attemptsLeft = allowed === null ? null : Math.max(0, allowed - lesson.attempts.length);
  const bestScore = lesson.attempts.length
    ? Math.max(...lesson.attempts.map((t) => t.score))
    : null;
  const waitingToSubmit = local.submissions.some(
    (s) => s.lessonId === lesson.id && s.state === 'queued',
  );
  const failedOut = !passed && attemptsLeft === 0 && !waitingToSubmit;
  return {
    lesson,
    progress,
    done: passed || failedOut,
    passed,
    bestScore,
    attemptsLeft,
    waitingToSubmit,
  };
}

function imageAspect(uri: string): Promise<number> {
  return new Promise((resolve) =>
    Image.getSize(
      uri,
      (w, h) => resolve(w > 0 && h > 0 ? w / h : 8.5 / 11),
      () => resolve(8.5 / 11),
    ),
  );
}

/** The lesson's page images on this phone: cached, or downloaded now (signed URLs). */
export function useLessonPages(
  userId: string,
  lesson: Pick<MyLesson, 'id' | 'version' | 'pageImagePaths'> | null,
  onProgress?: (done: number, total: number) => void,
) {
  return useQuery({
    queryKey: trainingKeys.pages(lesson?.id ?? '', lesson?.version ?? 0),
    enabled: lesson !== null,
    staleTime: Infinity,
    networkMode: 'always',
    queryFn: async (): Promise<CachedLesson> => {
      const l = lesson!;
      const cached = await readCachedLesson(userId, l.id, l.version);
      if (cached) return cached;
      try {
        const { data, error } = await supabase.storage
          .from(LESSON_FILES_BUCKET)
          .createSignedUrls(l.pageImagePaths, SIGNED_URL_MAX_SECONDS);
        if (error || !data) throw error ?? new Error('Could not load the pages.');
        const urls = l.pageImagePaths.map((p) => data.find((s) => s.path === p)?.signedUrl ?? '');
        if (urls.some((u) => !u)) throw new Error('Could not load the pages.');
        return await cacheLesson(userId, l.id, l.version, urls, imageAspect, onProgress);
      } catch (e) {
        const older = await latestCachedLesson(userId, l.id);
        if (older) return older;
        throw e;
      }
    },
  });
}

export type AssessmentOverview = {
  question_count: number;
  total_points: number;
  pass_mark_percent: number;
  time_limit_minutes: number | null;
  max_attempts: number | null;
  attempts_used: number;
  attempts_left: number | null;
  passed: boolean;
  reading_complete: boolean;
  show_correct_answers_after: ShowAnswersAfter;
  open_attempt: { id: string; started_at: string; expires_at: string | null } | null;
};

/** The quiz rules (does not start the clock). */
export function useAssessmentOverview(assessmentId: string) {
  return useQuery({
    queryKey: trainingKeys.overview(assessmentId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('assessment_overview', {
        p_assessment_id: assessmentId,
      });
      if (error) throw error;
      return data as unknown as AssessmentOverview;
    },
  });
}

/** The answer review for one of my attempts, when the assessment allows it (else null). */
export async function fetchAttemptReview(attemptId: string) {
  const { data, error } = await supabase.rpc('get_attempt_review', { p_attempt_id: attemptId });
  if (error) return null;
  const parsed = attemptResultSchema.shape.review.safeParse(data);
  return parsed.success ? parsed.data : null;
}
