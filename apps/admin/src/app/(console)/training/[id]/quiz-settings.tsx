'use client';

import {
  SHOW_ANSWERS_AFTER,
  SHOW_ANSWERS_AFTER_LABELS,
  type ShowAnswersAfter,
} from '@deltaguard/shared';
import { useActionState } from 'react';

import { Button, Field, FormMessage, Select } from '@/components/ui';

import { saveAssessmentSettings } from '../actions';

export type QuizSettings = {
  pass_mark_percent: number;
  max_attempts: number | null;
  time_limit_minutes: number | null;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_correct_answers_after: ShowAnswersAfter;
};

/** Pass mark, attempts, time limit, shuffling. Saving the first time creates the quiz. */
export function QuizSettingsForm({
  lessonId,
  settings,
  exists,
}: {
  lessonId: string;
  settings: QuizSettings | null;
  exists: boolean;
}) {
  const [state, action, pending] = useActionState(saveAssessmentSettings, null);
  const err = state?.fieldErrors ?? {};
  const s = settings;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="lesson_id" value={lessonId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Pass mark (%)"
          name="pass_mark_percent"
          type="number"
          min={1}
          max={100}
          required
          defaultValue={s?.pass_mark_percent ?? 70}
          error={err.pass_mark_percent}
        />
        <Field
          label="Attempts allowed (blank = unlimited)"
          name="max_attempts"
          type="number"
          min={1}
          max={100}
          defaultValue={s?.max_attempts ?? ''}
          error={err.max_attempts}
        />
        <Field
          label="Time limit, minutes (blank = none)"
          name="time_limit_minutes"
          type="number"
          min={1}
          max={600}
          defaultValue={s?.time_limit_minutes ?? ''}
          error={err.time_limit_minutes}
        />
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="shuffle_questions"
            defaultChecked={s?.shuffle_questions ?? false}
          />
          Shuffle questions
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="shuffle_options"
            defaultChecked={s?.shuffle_options ?? false}
          />
          Shuffle options
        </label>
        <Select
          label="Show correct answers"
          name="show_correct_answers_after"
          defaultValue={s?.show_correct_answers_after ?? 'never'}
        >
          {SHOW_ANSWERS_AFTER.map((v) => (
            <option key={v} value={v}>
              {SHOW_ANSWERS_AFTER_LABELS[v]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant={exists ? 'secondary' : 'primary'} disabled={pending}>
          {pending ? 'Saving…' : exists ? 'Save quiz settings' : 'Add a quiz'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
