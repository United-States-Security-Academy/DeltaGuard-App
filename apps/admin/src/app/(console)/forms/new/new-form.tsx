'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Button, Field, Textarea } from '@/components/ui';

import { attachFormPdf, createFormTemplate } from '../actions';
import { checkPdfFile, uploadFormPdf } from '../upload';

/**
 * New form: create the draft row, read the PDF in the browser (page images +
 * AcroForm fields), upload everything with the admin's session, record it,
 * then open the editor.
 */
export function NewFormForm() {
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
    const fileProblem = checkPdfFile(file);
    if (fileProblem) {
      setFieldErrors({ file: fileProblem });
      return;
    }

    setBusy(true);
    try {
      setProgress('Creating the form…');
      const created = await createFormTemplate({
        title: String(fd.get('title') ?? ''),
        description: String(fd.get('description') ?? ''),
      });
      if (!created.ok) {
        setFieldErrors(created.fieldErrors ?? {});
        setError(created.message);
        return;
      }
      let attached;
      try {
        const upload = await uploadFormPdf(created.id, file!, setProgress);
        setProgress('Saving…');
        attached = await attachFormPdf(upload);
      } catch (e) {
        attached = { ok: false, message: (e as Error).message };
      }
      if (!attached?.ok) {
        // The draft exists: let the admin retry the upload from its page.
        router.push(`/forms/${created.id}?upload_error=1`);
        return;
      }
      router.push(`/forms/${created.id}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Title" name="title" required maxLength={200} error={fieldErrors.title} />
      <Textarea
        label="Description (optional, shown to officers)"
        name="description"
        rows={3}
        maxLength={4000}
        error={fieldErrors.description}
      />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">PDF form (up to 50 MB)</span>
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
          {busy ? 'Working…' : 'Create form'}
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
