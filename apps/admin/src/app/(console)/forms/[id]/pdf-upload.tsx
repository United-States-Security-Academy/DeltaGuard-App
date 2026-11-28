'use client';

import { useRouter } from 'next/navigation';
import { type ChangeEvent, useRef, useState } from 'react';

import { Button, FormMessage } from '@/components/ui';

import { attachFormPdf } from '../actions';
import { checkPdfFile, uploadFormPdf } from '../upload';

/** Upload (or replace) the form's PDF: pages rendered and AcroForm fields read in the browser. */
export function PdfUpload({ templateId, hasPdf }: { templateId: string; hasPdf: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    const problem = checkPdfFile(file);
    if (problem) return setState({ ok: false, message: problem });
    if (
      hasPdf &&
      !window.confirm(
        'Replace the PDF? Fields you placed stay where they are; check them against the new pages. Officers keep the published version until you publish again.',
      )
    ) {
      return;
    }
    setState(null);
    try {
      const upload = await uploadFormPdf(templateId, file!, setProgress);
      setProgress('Saving…');
      const result = await attachFormPdf(upload);
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
