import 'server-only';

import type { QuestionType } from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type BuilderQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  explanation: string | null;
  points: number;
  sort_order: number;
  options: { id: string; text: string; is_correct: boolean; sort_order: number }[];
};

/** A lesson with its quiz (answer key included: staff only) and assignments. RLS applies. */
export async function loadLesson(supabase: Supabase, id: string) {
  const [lesson, assessment, assignments] = await Promise.all([
    supabase.from('lessons').select('*').eq('id', id).maybeSingle(),
    supabase.from('assessments').select('*').eq('lesson_id', id).maybeSingle(),
    supabase
      .from('lesson_assignments')
      .select(
        `id, officer_id, site_id, role, due_at, created_at, creates_qualification_type,
         qualification_valid_months,
         officer:profiles!lesson_assignments_officer_id_fkey(full_name),
         sites(name)`,
      )
      .eq('lesson_id', id)
      .order('created_at', { ascending: false }),
  ]);
  if (lesson.error) throw lesson.error;
  if (!lesson.data) return null;

  let questions: BuilderQuestion[] = [];
  let attemptCount = 0;
  if (assessment.data) {
    const [q, attempts] = await Promise.all([
      supabase
        .from('questions')
        .select(
          'id, type, prompt, explanation, points, sort_order, question_options(id, text, is_correct, sort_order)',
        )
        .eq('assessment_id', assessment.data.id)
        .order('sort_order')
        .order('created_at'),
      supabase
        .from('assessment_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_id', assessment.data.id)
        .not('submitted_at', 'is', null),
    ]);
    questions = (q.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      prompt: row.prompt,
      explanation: row.explanation,
      points: row.points,
      sort_order: row.sort_order,
      options: [...row.question_options].sort((a, b) => a.sort_order - b.sort_order),
    }));
    attemptCount = attempts.count ?? 0;
  }

  return {
    lesson: lesson.data,
    assessment: assessment.data,
    questions,
    attemptCount,
    assignments: assignments.data ?? [],
  };
}

export type LoadedLesson = NonNullable<Awaited<ReturnType<typeof loadLesson>>>;
