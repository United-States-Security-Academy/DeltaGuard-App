'use server';

import {
  assessmentSchema,
  fromZoned,
  LESSON_FILES_BUCKET,
  lessonAssignmentSchema,
  lessonSchema,
  questionSchema,
  recordIdSchema,
} from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { checked, num, text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../schedule/data';
import { parseQuestionCsv } from './question-csv';
import { publicMessage } from '@/lib/server-errors';

// Every write runs as the signed-in admin: RLS and the database functions
// decide. Grading never happens here (submit_attempt on the server).

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export type CreateLessonResult =
  { ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function createLesson(input: {
  title: string;
  description: string;
  estimated_minutes: number | null;
}): Promise<CreateLessonResult> {
  await requireAdmin();
  const parsed = lessonSchema.safeParse(input);
  if (!parsed.success) {
    const state = invalid(parsed.error);
    return { ok: false, message: state!.message, fieldErrors: state!.fieldErrors };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from('lessons').insert(parsed.data).select('id').single();
  if (error) return failed(error);
  return { ok: true, id: data.id };
}

const attachSchema = z
  .object({
    lesson_id: z.uuid(),
    pdf_path: z.string().max(500),
    page_count: z.number().int().min(1).max(500),
    page_image_paths: z.array(z.string().max(500)).min(1).max(500),
  })
  .refine(
    (a) =>
      [a.pdf_path, ...a.page_image_paths].every((p) => p.startsWith(`${a.lesson_id}/`)) &&
      a.page_image_paths.length === a.page_count,
    'The uploaded files are not in this lesson’s folder',
  );

/** After the browser uploaded the PDF and its page images: record them, remove the old files. */
export async function attachLessonPdf(input: unknown): Promise<ActionState> {
  await requireAdmin();
  const parsed = attachSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid upload' };
  const a = parsed.data;
  const supabase = await createClient();
  const { data: old } = await supabase
    .from('lessons')
    .select('pdf_path, page_image_paths, status')
    .eq('id', a.lesson_id)
    .maybeSingle();
  if (!old) return { ok: false, message: 'Lesson not found.' };

  const { error } = await supabase
    .from('lessons')
    .update({
      pdf_path: a.pdf_path,
      page_count: a.page_count,
      page_image_paths: a.page_image_paths,
    })
    .eq('id', a.lesson_id);
  if (error) return failed(error);

  const stale = [old.pdf_path, ...old.page_image_paths].filter(
    (p): p is string => !!p && p !== a.pdf_path && !a.page_image_paths.includes(p),
  );
  if (stale.length > 0) await supabase.storage.from(LESSON_FILES_BUCKET).remove(stale);

  refresh();
  return {
    ok: true,
    message:
      old.status === 'draft'
        ? `PDF saved (${a.page_count} pages).`
        : `PDF replaced (${a.page_count} pages): a new version. Officers see the new pages; their reading progress is kept.`,
  };
}

export async function updateLessonDetails(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  const parsed = lessonSchema.safeParse({
    title: text(fd, 'title') ?? '',
    description: text(fd, 'description') ?? '',
    estimated_minutes: num(fd, 'estimated_minutes'),
  });
  if (!id.success) return { ok: false, message: 'Lesson not found.' };
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from('lessons').update(parsed.data).eq('id', id.data.id);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Saved.' };
}

/** Publish, archive or restore (the database checks the PDF and every question). */
export async function setLessonStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  const status = z.enum(['published', 'archived']).safeParse(text(fd, 'status'));
  if (!id.success || !status.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('lessons')
    .update({ status: status.data })
    .eq('id', id.data.id);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: status.data === 'published' ? 'Published.' : 'Archived.' };
}

export async function deleteDraftLesson(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Lesson not found.' };
  const supabase = await createClient();
  const { data: lesson } = await supabase
    .from('lessons')
    .select('status, pdf_path, page_image_paths')
    .eq('id', id.data.id)
    .maybeSingle();
  if (!lesson) return { ok: false, message: 'Lesson not found.' };
  if (lesson.status !== 'draft')
    return { ok: false, message: 'Only a draft can be deleted. Archive it instead.' };
  const { error } = await supabase.from('lessons').delete().eq('id', id.data.id);
  if (error) return failed(error);
  const files = [lesson.pdf_path, ...lesson.page_image_paths].filter((p): p is string => !!p);
  if (files.length > 0) await supabase.storage.from(LESSON_FILES_BUCKET).remove(files);
  redirect('/training');
}

// ---------------------------------------------------------------------------
// Assessment and questions
// ---------------------------------------------------------------------------

/** Creates the lesson's assessment or updates its settings. */
export async function saveAssessmentSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const lessonId = recordIdSchema.safeParse({ id: text(fd, 'lesson_id') });
  if (!lessonId.success) return { ok: false, message: 'Lesson not found.' };
  const parsed = assessmentSchema.safeParse({
    pass_mark_percent: num(fd, 'pass_mark_percent') ?? 70,
    max_attempts: num(fd, 'max_attempts'),
    time_limit_minutes: num(fd, 'time_limit_minutes'),
    shuffle_questions: checked(fd, 'shuffle_questions'),
    shuffle_options: checked(fd, 'shuffle_options'),
    show_correct_answers_after: text(fd, 'show_correct_answers_after') ?? 'never',
  });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from('assessments')
    .upsert({ lesson_id: lessonId.data.id, ...parsed.data }, { onConflict: 'lesson_id' });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Quiz settings saved.' };
}

/** The ids that link an edited question and its options to what is stored. */
const questionIdsSchema = z.object({
  id: z.uuid().nullable(),
  options: z.array(z.object({ id: z.uuid().nullable() }).loose()),
});

export type SaveQuestionResult = {
  ok: boolean;
  message: string;
  problems?: Record<string, string>;
};

/** Adds or edits one question (ids kept, so earlier answers stay linked). */
export async function saveQuestion(
  assessmentId: string,
  input: unknown,
): Promise<SaveQuestionResult> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: assessmentId });
  const parsed = questionSchema.safeParse(input);
  const ids = questionIdsSchema.safeParse(input);
  if (!id.success || !ids.success) return { ok: false, message: 'Quiz not found.' };
  if (!parsed.success) {
    const problems: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      problems[String(issue.path[0] ?? 'form')] ??= issue.message;
    return { ok: false, message: 'Please fix the question.', problems };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_questions', {
    p_assessment_id: id.data.id,
    p_questions: [
      {
        ...parsed.data,
        id: ids.data.id,
        options: parsed.data.options.map((o, i) => ({ ...o, id: ids.data.options[i]?.id ?? null })),
      },
    ],
  });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Question saved.' };
}

export async function deleteQuestion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Question not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('questions').delete().eq('id', id.data.id);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Question deleted.' };
}

export async function reorderQuestions(assessmentId: string, ids: string[]): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({ a: z.uuid(), ids: z.array(z.uuid()).max(500) })
    .safeParse({ a: assessmentId, ids });
  if (!parsed.success) return { ok: false, message: 'Invalid order.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reorder_questions', {
    p_assessment_id: parsed.data.a,
    p_ids: parsed.data.ids,
  });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Order saved.' };
}

/** Adds every question of a CSV file (all or nothing). */
export async function importQuestionsCsv(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'assessment_id') });
  const file = fd.get('file');
  if (!id.success) return { ok: false, message: 'Quiz not found.' };
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: 'Choose a CSV file.' };
  if (file.size > 1024 * 1024) return { ok: false, message: 'The CSV is larger than 1 MB.' };

  const { questions, errors } = parseQuestionCsv(await file.text());
  if (errors.length > 0) {
    return {
      ok: false,
      message: `Nothing imported. ${errors.slice(0, 5).join(' ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`,
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_questions', {
    p_assessment_id: id.data.id,
    p_questions: questions,
  });
  if (error) return { ok: false, message: `Nothing imported. ${publicMessage(error)}` };
  refresh();
  return {
    ok: true,
    message: `Imported ${questions.length} question${questions.length === 1 ? '' : 's'}.`,
  };
}

// ---------------------------------------------------------------------------
// Assignments (the database sends the push notifications)
// ---------------------------------------------------------------------------

export async function createLessonAssignment(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const target = text(fd, 'target');
  const dueDate = text(fd, 'due_date');
  const dueTime = text(fd, 'due_time') ?? '23:59';
  const supabase = await createClient();

  let dueAt: string | null = null;
  if (dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{2}:\d{2}$/.test(dueTime)) {
      return {
        ok: false,
        message: 'Enter a valid due date.',
        fieldErrors: { due_date: 'Invalid date' },
      };
    }
    dueAt = fromZoned(dueDate, dueTime, await getTimeZone(supabase)).toISOString();
    if (Date.parse(dueAt) < Date.now()) {
      return {
        ok: false,
        message: 'The due date is in the past.',
        fieldErrors: { due_date: 'In the past' },
      };
    }
  }

  const parsed = lessonAssignmentSchema.safeParse({
    lesson_id: text(fd, 'lesson_id'),
    officer_id: target === 'officer' ? text(fd, 'officer_id') : null,
    site_id: target === 'site' ? text(fd, 'site_id') : null,
    role: target === 'role' ? text(fd, 'role') : null,
    due_at: dueAt,
    creates_qualification_type: text(fd, 'creates_qualification_type') ?? '',
    qualification_valid_months: num(fd, 'qualification_valid_months'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const { error } = await supabase.from('lesson_assignments').insert(parsed.data);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Assigned. Everyone it reaches gets a notification on their phone.' };
}

export async function deleteLessonAssignment(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Assignment not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('lesson_assignments').delete().eq('id', id.data.id);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Assignment removed.' };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export async function grantExtraAttempt(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({ assessment_id: z.uuid(), officer_id: z.uuid(), reason: z.string().trim().max(500) })
    .safeParse({
      assessment_id: text(fd, 'assessment_id'),
      officer_id: text(fd, 'officer_id'),
      reason: text(fd, 'reason') ?? '',
    });
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grant_extra_attempt', {
    p_assessment_id: parsed.data.assessment_id,
    p_officer_id: parsed.data.officer_id,
    p_reason: parsed.data.reason || undefined,
  });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: `Extra attempt granted (${data} allowed now).` };
}
