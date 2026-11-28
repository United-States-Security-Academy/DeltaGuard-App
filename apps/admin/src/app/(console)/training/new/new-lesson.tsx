'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Button, Field, Textarea } from '@/components/ui';

import { attachLessonPdf, createLesson } from '../actions';
import { checkLessonPdf, uploadLessonPdf } from '../upload';

/** Create the draft lesson, render and upload the PDF, record it, open the lesson. */
export function NewLessonForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const file = fd.get('file') instanceof File ? (fd.get('file') as File) : null;
    setError(null);
    setFieldErrors({});
    const problem = checkLessonPdf(file);
    if (problem) return setFieldErrors({ file: problem });

    setBusy(true);
    try {
      setProgress('Creating the lesson…');
      const minutes = String(fd.get('estimated_minutes') ?? '').trim();
      const created = await createLesson({
        title: String(fd.get('title') ?? ''),
        description: String(fd.get('description') ?? ''),
        estimated_minutes: minutes === '' ? null : Number(minutes),
      });
      if (!created.ok) {
        setFieldErrors(created.fieldErrors ?? {});
        setError(created.message);
        return;
      }
      try {
        const upload = await uploadLessonPdf(created.id, file!, setProgress);
        setProgress('Saving…');
        const attached = await attachLessonPdf(upload);
        if (!attached?.ok) throw new Error(attached?.message);
        router.push(`/training/${created.id}`);
      } catch {
        router.push(`/training/${created.id}?upload_error=1`);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Title" name="title" required maxLength={200} error={fieldErrors.title} />
      <Textarea
        label="Description (shown to officers)"
        name="description"
        rows={3}
        maxLength={4000}
        error={fieldErrors.description}
      />
      <Field
        label="Estimated minutes (optional)"
        name="estimated_minutes"
        type="number"
        min={1}
        max={600}
        error={fieldErrors.estimated_minutes}
      />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Lesson PDF (up to 100 MB)</span>
        <input
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          required
          className="text-sm file:mr-3 file:rounded-full file:border file:border-line file:bg-surface file:px-3 file:py-1.5"
        />
        {fieldErrors.file ? (
          <span className="text-red-600 dark:text-red-400">{fieldErrors.file}</span>
        ) : null}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Working…' : 'Create lesson'}
        </Button>
        {progress ? <span className="text-sm text-muted">{progress}</span> : null}
        {error ? (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
