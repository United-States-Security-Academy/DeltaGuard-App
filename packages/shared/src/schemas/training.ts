import { z } from 'zod';

// Training (phase 16): lessons, assessments, questions, assignments, and the
// officer's progress and answers. Mirrors the tables and the RPC arguments;
// the database checks everything again (and grades only on the server).

// Keep in sync with the Postgres enums in the phase 16 migration.
export const LESSON_STATUSES = ['draft', 'published', 'archived'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: 'One answer',
  multiple_choice: 'Several answers',
  true_false: 'True / false',
};

export const SHOW_ANSWERS_AFTER = ['never', 'after_pass', 'after_final_attempt'] as const;
export type ShowAnswersAfter = (typeof SHOW_ANSWERS_AFTER)[number];
export const SHOW_ANSWERS_AFTER_LABELS: Record<ShowAnswersAfter, string> = {
  never: 'Never',
  after_pass: 'After passing',
  after_final_attempt: 'After passing or the last attempt',
};

/** Private bucket: <lesson_id>/<upload_id>/original.pdf and page-<n>.png. */
export const LESSON_FILES_BUCKET = 'lesson-files';

/** SQLSTATEs the training functions raise for the app. */
export const TRAINING_ERROR_CODES = {
  readingNotComplete: 'DG010',
  noAttemptsLeft: 'DG011',
  alreadyPassed: 'DG012',
} as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const lessonSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200),
  description: optionalText(4000),
  estimated_minutes: z.number().int().min(1).max(600).nullable(),
});
export type LessonInput = z.infer<typeof lessonSchema>;

export const assessmentSchema = z.object({
  pass_mark_percent: z.number().int().min(1).max(100),
  max_attempts: z.number().int().min(1).max(100).nullable(),
  time_limit_minutes: z.number().int().min(1).max(600).nullable(),
  shuffle_questions: z.boolean(),
  shuffle_options: z.boolean(),
  show_correct_answers_after: z.enum(SHOW_ANSWERS_AFTER),
});
export type AssessmentInput = z.infer<typeof assessmentSchema>;

export const questionOptionSchema = z.object({
  text: z.string().trim().min(1, 'Enter the option').max(500),
  is_correct: z.boolean(),
});

/** A question with its options, checked the way publishing checks them. */
export const questionSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().trim().min(1, 'Enter the question').max(2000),
    explanation: optionalText(4000),
    points: z.number().int().min(1).max(100),
    options: z.array(questionOptionSchema).min(2, 'Add at least two options').max(10),
  })
  .superRefine((q, ctx) => {
    const correct = q.options.filter((o) => o.is_correct).length;
    if (q.type === 'true_false' && q.options.length !== 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'True / false has exactly two options',
      });
    }
    if (q.type !== 'multiple_choice' && correct !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Mark exactly one correct answer',
      });
    }
    if (q.type === 'multiple_choice' && correct < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Mark at least one correct answer',
      });
    }
  });
export type QuestionInput = z.infer<typeof questionSchema>;

export const lessonAssignmentSchema = z
  .object({
    lesson_id: z.uuid(),
    officer_id: z.uuid().nullable(),
    site_id: z.uuid().nullable(),
    role: z.enum(['officer', 'supervisor', 'admin']).nullable(),
    due_at: z.iso.datetime({ offset: true }).nullable(),
    creates_qualification_type: optionalText(100),
    qualification_valid_months: z.number().int().min(1).max(240).nullable(),
  })
  .refine(
    (a) => [a.officer_id, a.site_id, a.role].filter((v) => v !== null).length === 1,
    'Assign to exactly one officer, site or role',
  )
  .refine((a) => a.qualification_valid_months === null || a.creates_qualification_type !== null, {
    message: 'Name the qualification the lesson gives',
    path: ['creates_qualification_type'],
  });
export type LessonAssignmentInput = z.infer<typeof lessonAssignmentSchema>;

/** record_lesson_progress() arguments. */
export const lessonProgressSchema = z.object({
  p_lesson_id: z.uuid(),
  p_pages: z.array(z.number().int().min(1)).max(500),
  p_seconds: z.number().int().min(0),
});

/** submit_attempt() answers: question id -> chosen option ids. */
export const attemptAnswersSchema = z.record(z.uuid(), z.array(z.uuid()).max(10));
export type AttemptAnswers = z.infer<typeof attemptAnswersSchema>;

export const submitAttemptSchema = z.object({
  p_assessment_id: z.uuid(),
  p_answers: attemptAnswersSchema,
});

/** What get_assessment_for_officer() returns (no answer key). */
export const officerAssessmentSchema = z.object({
  assessment_id: z.uuid(),
  lesson_id: z.uuid(),
  pass_mark_percent: z.number(),
  max_attempts: z.number().nullable(),
  time_limit_minutes: z.number().nullable(),
  attempt: z.object({
    id: z.uuid(),
    attempt_number: z.number(),
    started_at: z.string(),
    expires_at: z.string().nullable(),
    attempts_left: z.number().nullable(),
  }),
  questions: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(QUESTION_TYPES),
      prompt: z.string(),
      points: z.number(),
      options: z.array(z.object({ id: z.uuid(), text: z.string() })),
    }),
  ),
});
export type OfficerAssessment = z.infer<typeof officerAssessmentSchema>;

/** What submit_attempt() returns. `review` only when answers may be shown. */
export const attemptResultSchema = z.object({
  attempt_id: z.uuid(),
  attempt_number: z.number(),
  score_percent: z.coerce.number(),
  passed: z.boolean(),
  timed_out: z.boolean(),
  pass_mark_percent: z.number(),
  attempts_left: z.number().nullable(),
  review: z
    .array(
      z.object({
        question_id: z.uuid(),
        prompt: z.string(),
        explanation: z.string().nullable(),
        your_option_ids: z.array(z.uuid()),
        correct_option_ids: z.array(z.uuid()),
        options: z.array(z.object({ id: z.uuid(), text: z.string() })),
      }),
    )
    .nullable(),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;
