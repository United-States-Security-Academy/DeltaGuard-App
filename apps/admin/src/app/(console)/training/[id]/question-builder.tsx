'use client';

import {
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type QuestionType,
  questionSchema,
} from '@deltaguard/shared';
import { useActionState, useState, useTransition } from 'react';

import { ActionButton } from '@/components/action-form';
import { Badge, Button, FormMessage } from '@/components/ui';

import { deleteQuestion, importQuestionsCsv, reorderQuestions, saveQuestion } from '../actions';
import { formatScore } from '../labels';

type Option = { id: string | null; text: string; is_correct: boolean };
type Question = {
  id: string | null;
  type: QuestionType;
  prompt: string;
  explanation: string;
  points: number;
  options: Option[];
};

export type BuilderQuestionProps = {
  id: string;
  type: QuestionType;
  prompt: string;
  explanation: string | null;
  points: number;
  options: { id: string; text: string; is_correct: boolean }[];
};

const inputClass =
  'rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30';

function blank(type: QuestionType = 'single_choice'): Question {
  return {
    id: null,
    type,
    prompt: '',
    explanation: '',
    points: 1,
    options:
      type === 'true_false'
        ? [
            { id: null, text: 'True', is_correct: true },
            { id: null, text: 'False', is_correct: false },
          ]
        : [
            { id: null, text: '', is_correct: true },
            { id: null, text: '', is_correct: false },
          ],
  };
}

export function QuestionBuilder({
  assessmentId,
  questions,
  attemptCount,
  shuffleQuestions,
  shuffleOptions,
  passMark,
}: {
  assessmentId: string;
  questions: BuilderQuestionProps[];
  attemptCount: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  passMark: number;
}) {
  const [editing, setEditing] = useState<Question | null>(null);
  const [order, setOrder] = useState(questions.map((q) => q.id));
  const [orderState, setOrderState] = useState<{ ok: boolean; message: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [, startTransition] = useTransition();
  const byId = new Map(questions.map((q) => [q.id, q]));
  const list = order.map((id) => byId.get(id)).filter((q): q is BuilderQuestionProps => !!q);

  function move(index: number, by: -1 | 1) {
    const next = [...order];
    const j = index + by;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    setOrder(next);
    startTransition(async () => setOrderState(await reorderQuestions(assessmentId, next)));
  }

  return (
    <div className="flex flex-col gap-4">
      {attemptCount > 0 ? (
        <p className="rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          Officers have already submitted {attemptCount} attempt{attemptCount === 1 ? '' : 's'}.
          Editing keeps their scores; their answers still show against the edited questions, and
          answers to deleted questions or options are no longer shown.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setEditing(blank())}>
          Add question
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setPreviewing((p) => !p)}
          disabled={list.length === 0}
        >
          {previewing ? 'Close preview' : 'Preview as an officer'}
        </Button>
        <FormMessage state={orderState} />
      </div>

      {editing ? (
        <QuestionEditor
          key={editing.id ?? 'new'}
          assessmentId={assessmentId}
          initial={editing}
          onDone={() => setEditing(null)}
        />
      ) : null}

      {previewing ? (
        <QuizPreview
          questions={list}
          shuffleQuestions={shuffleQuestions}
          shuffleOptions={shuffleOptions}
          passMark={passMark}
        />
      ) : null}

      {list.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line p-6 text-center text-sm text-muted">
          No questions yet. Add them one by one or import a CSV.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {list.map((q, i) => (
            <li key={q.id} className="flex flex-col gap-2 panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted">
                    {i + 1}. {QUESTION_TYPE_LABELS[q.type]} · {q.points} point
                    {q.points === 1 ? '' : 's'}
                  </span>
                  <span className="font-medium whitespace-pre-wrap">{q.prompt}</span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <SmallButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </SmallButton>
                  <SmallButton
                    label="Move down"
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </SmallButton>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setEditing({
                        id: q.id,
                        type: q.type,
                        prompt: q.prompt,
                        explanation: q.explanation ?? '',
                        points: q.points,
                        options: q.options.map((o) => ({
                          id: o.id,
                          text: o.text,
                          is_correct: o.is_correct,
                        })),
                      })
                    }
                  >
                    Edit
                  </Button>
                  <ActionButton
                    action={deleteQuestion}
                    fields={{ id: q.id }}
                    label="Delete"
                    variant="danger"
                    confirm="Delete this question?"
                  />
                </div>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {q.options.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <span
                      className={
                        o.is_correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'
                      }
                    >
                      {o.is_correct ? '✓' : '○'}
                    </span>
                    {o.text}
                  </li>
                ))}
              </ul>
              {q.explanation ? (
                <p className="text-xs text-muted">Explanation: {q.explanation}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <CsvImport assessmentId={assessmentId} />
    </div>
  );
}

function SmallButton({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="size-8 rounded-full border border-line text-sm disabled:opacity-30"
      {...props}
    >
      {children}
    </button>
  );
}

function QuestionEditor({
  assessmentId,
  initial,
  onDone,
}: {
  assessmentId: string;
  initial: Question;
  onDone: () => void;
}) {
  const [q, setQ] = useState<Question>(initial);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const single = q.type !== 'multiple_choice';

  function setType(type: QuestionType) {
    if (type === 'true_false') {
      const keep = q.type === 'true_false' ? q.options : blank('true_false').options;
      setQ({ ...q, type, options: keep });
    } else {
      const options =
        q.type === 'true_false' && q.options.every((o) => !o.id) ? blank(type).options : q.options;
      // One correct answer for single choice.
      const first = options.findIndex((o) => o.is_correct);
      setQ({
        ...q,
        type,
        options:
          type === 'single_choice'
            ? options.map((o, i) => ({ ...o, is_correct: i === first }))
            : options,
      });
    }
  }

  function setOption(index: number, patch: Partial<Option>) {
    setQ({
      ...q,
      options: q.options.map((o, i) =>
        i === index
          ? { ...o, ...patch }
          : patch.is_correct && single
            ? { ...o, is_correct: false }
            : o,
      ),
    });
  }

  function save() {
    const checked = questionSchema.safeParse(q);
    if (!checked.success) {
      const found: Record<string, string> = {};
      for (const issue of checked.error.issues)
        found[String(issue.path[0] ?? 'form')] ??= issue.message;
      setProblems(found);
      setState({ ok: false, message: 'Please fix the question.' });
      return;
    }
    setProblems({});
    startSaving(async () => {
      const result = await saveQuestion(assessmentId, q);
      setState(result);
      setProblems(result.problems ?? {});
      if (result.ok) onDone();
    });
  }

  return (
    <div className="flex flex-col gap-4 panel border-gold/50 p-5">
      <h3 className="font-semibold">{q.id ? 'Edit question' : 'New question'}</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Question</span>
          <textarea
            className={`${inputClass} min-h-20`}
            value={q.prompt}
            maxLength={2000}
            onChange={(e) => setQ({ ...q, prompt: e.target.value })}
          />
          {problems.prompt ? <span className="text-red-600">{problems.prompt}</span> : null}
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Type</span>
          <select
            className={inputClass}
            value={q.type}
            onChange={(e) => setType(e.target.value as QuestionType)}
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Points</span>
          <input
            className={`${inputClass} w-20`}
            type="number"
            min={1}
            max={100}
            value={q.points}
            onChange={(e) => setQ({ ...q, points: Number(e.target.value) || 1 })}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Options — mark {single ? 'the correct one' : 'every correct one'}
        </legend>
        {q.options.map((o, i) => (
          <div key={o.id ?? `new-${i}`} className="flex items-center gap-2">
            <input
              type={single ? 'radio' : 'checkbox'}
              name="correct"
              checked={o.is_correct}
              onChange={(e) => setOption(i, { is_correct: e.target.checked })}
              aria-label={`Option ${i + 1} is correct`}
            />
            <input
              className={`${inputClass} flex-1`}
              value={o.text}
              maxLength={500}
              readOnly={q.type === 'true_false'}
              placeholder={`Option ${i + 1}`}
              onChange={(e) => setOption(i, { text: e.target.value })}
            />
            {q.type !== 'true_false' && q.options.length > 2 ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => setQ({ ...q, options: q.options.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {q.type !== 'true_false' && q.options.length < 10 ? (
          <button
            type="button"
            className="self-start text-sm text-muted hover:underline"
            onClick={() =>
              setQ({ ...q, options: [...q.options, { id: null, text: '', is_correct: false }] })
            }
          >
            + Add option
          </button>
        ) : null}
        {problems.options ? <span className="text-sm text-red-600">{problems.options}</span> : null}
      </fieldset>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Explanation (optional, shown with the correct answer)</span>
        <textarea
          className={`${inputClass} min-h-16`}
          value={q.explanation}
          maxLength={4000}
          onChange={(e) => setQ({ ...q, explanation: e.target.value })}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save question'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <FormMessage state={state} />
      </div>
    </div>
  );
}

function CsvImport({ assessmentId }: { assessmentId: string }) {
  const [state, action, pending] = useActionState(importQuestionsCsv, null);
  return (
    <form action={action} className="flex flex-col gap-3 panel p-4">
      <input type="hidden" name="assessment_id" value={assessmentId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Import questions from CSV</h3>
        <a
          href="/training/questions-template"
          download
          className="text-sm text-muted hover:underline"
        >
          Download the template
        </a>
      </div>
      <p className="text-xs text-muted">
        One question per row: type, prompt, option_1 … option_6, correct (option numbers like “1;3”,
        or true/false), explanation, points. Questions are added at the end; if any row is wrong,
        nothing is imported.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm file:mr-3 file:rounded-full file:border file:border-line file:bg-surface file:px-3 file:py-1.5"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Importing…' : 'Import'}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

function shuffled<T>(items: T[], on: boolean): T[] {
  if (!on) return items;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The quiz as the phone shows it (no answer key on screen), checked locally. */
function QuizPreview({
  questions,
  shuffleQuestions,
  shuffleOptions,
  passMark,
}: {
  questions: BuilderQuestionProps[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  passMark: number;
}) {
  const [quiz] = useState(() =>
    shuffled(questions, shuffleQuestions).map((q) => ({
      ...q,
      options: shuffled(q.options, shuffleOptions),
    })),
  );
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<{ score: number; wrong: Set<string> } | null>(null);

  function choose(q: BuilderQuestionProps, optionId: string, on: boolean) {
    setResult(null);
    setAnswers((a) => {
      const current = a[q.id] ?? [];
      const next =
        q.type === 'multiple_choice'
          ? on
            ? [...current, optionId]
            : current.filter((id) => id !== optionId)
          : [optionId];
      return { ...a, [q.id]: next };
    });
  }

  function check() {
    let total = 0;
    let earned = 0;
    const wrong = new Set<string>();
    for (const q of quiz) {
      total += q.points;
      const chosen = new Set(answers[q.id] ?? []);
      const key = new Set(q.options.filter((o) => o.is_correct).map((o) => o.id));
      const right =
        chosen.size > 0 && chosen.size === key.size && [...key].every((id) => chosen.has(id));
      if (right) earned += q.points;
      else wrong.add(q.id);
    }
    setResult({ score: total ? Math.round((earned * 10000) / total) / 100 : 0, wrong });
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-[40px] border-8 border-slate-800 bg-ink p-5 text-white shadow-xl">
      <p className="mb-4 text-center text-sm font-extrabold">Quiz preview</p>
      <ol className="flex flex-col gap-5">
        {quiz.map((q, i) => (
          <li key={q.id} className="flex flex-col gap-2">
            <span className="text-[10px] font-bold tracking-[2px] text-white/60 uppercase">
              Question {i + 1} ·{' '}
              {q.type === 'multiple_choice' ? 'choose all that apply' : 'choose one'}
            </span>
            <span className="text-sm font-semibold">{q.prompt}</span>
            {q.options.map((o) => {
              const selected = (answers[q.id] ?? []).includes(o.id);
              return (
                <label
                  key={o.id}
                  className={`flex items-center gap-3 rounded-full border px-4 py-2.5 text-sm ${selected ? 'border-gold bg-gold/15' : 'border-white/15'}`}
                >
                  <input
                    type={q.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                    name={`preview-${q.id}`}
                    checked={selected}
                    onChange={(e) => choose(q, o.id, e.target.checked)}
                    className="accent-[#D6B562]"
                  />
                  {o.text}
                </label>
              );
            })}
            {result?.wrong.has(q.id) ? (
              <span className="text-xs text-red-400">Not right</span>
            ) : null}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={check}
        className="mt-5 w-full rounded-full bg-gold py-3 text-sm font-bold text-ink"
      >
        Submit
      </button>
      {result ? (
        <p className="mt-3 text-center text-sm">
          Score {formatScore(result.score)}{' '}
          <Badge tone={result.score >= passMark ? 'good' : 'bad'}>
            {result.score >= passMark ? 'Pass' : 'Fail'}
          </Badge>
          <span className="mt-1 block text-xs text-white/50">
            Preview only: graded in your browser, nothing is saved. Officers are graded on the
            server.
          </span>
        </p>
      ) : null}
    </div>
  );
}
