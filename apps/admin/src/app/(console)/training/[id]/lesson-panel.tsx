'use client';

import { useRouter } from 'next/navigation';
import { type ChangeEvent, useActionState, useRef, useState } from 'react';

import { Button, Field, FormMessage, Textarea } from '@/components/ui';

import { attachLessonPdf, updateLessonDetails } from '../actions';
import { checkLessonPdf, uploadLessonPdf } from '../upload';

export function LessonDetailsForm({
  id,
  title,
  description,
  estimatedMinutes,
}: {
  id: string;
  title: string;
  description: string | null;
  estimatedMinutes: number | null;
}) {
  const [state, action, pending] = useActionState(updateLessonDetails, null);
  const err = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Field
        label="Title"
        name="title"
        defaultValue={title}
        required
        maxLength={200}
        error={err.title}
      />
      <Textarea
        label="Description (shown to officers)"
        name="description"
        defaultValue={description ?? ''}
        rows={3}
        maxLength={4000}
        error={err.description}
      />
      <Field
        label="Estimated minutes"
        name="estimated_minutes"
        type="number"
        min={1}
        max={600}
        defaultValue={estimatedMinutes ?? ''}
        error={err.estimated_minutes}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** Upload or replace the lesson PDF (pages rendered in the browser). */
export function LessonPdfUpload({
  lessonId,
  hasPdf,
  published,
}: {
  lessonId: string;
  hasPdf: boolean;
  published: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    const problem = checkLessonPdf(file);
    if (problem) return setState({ ok: false, message: problem });
    if (
      published &&
      !window.confirm(
        'Replace the PDF? Officers will see the new pages at once (a new lesson version).',
      )
    ) {
      return;
    }
    setState(null);
    try {
      const upload = await uploadLessonPdf(lessonId, file!, setProgress);
      setProgress('Saving…');
      const result = await attachLessonPdf(upload);
      setState(result);
      if (result?.ok) router.refresh();
    } catch (e) {
      setState({ ok: false, message: (e as Error).message });
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={onFile}
      />
      <Button
        type="button"
        variant={hasPdf ? 'secondary' : 'primary'}
        disabled={progress !== null}
        onClick={() => input.current?.click()}
      >
        {progress ? 'Working…' : hasPdf ? 'Replace PDF' : 'Upload PDF'}
      </Button>
      {progress ? (
        <span className="text-sm text-muted">{progress}</span>
      ) : (
        <FormMessage state={state} />
      )}
    </div>
  );
}
