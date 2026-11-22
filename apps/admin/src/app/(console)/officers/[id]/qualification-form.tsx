'use client';

import {
  LICENSE_FILE_EXTENSIONS,
  LICENSE_FILE_MIME_TYPES,
  licenseFileSchema,
  LICENSES_BUCKET,
} from '@deltaguard/shared';
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button, Field, FormMessage } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

import { addQualification } from '../actions';

/**
 * Add a licence or certificate, with an optional scan. The scan is uploaded
 * from the browser straight to the private `licenses` bucket at
 * "<officer id>/<random>.<ext>" using the admin's own session (storage RLS
 * only lets admins upload), then the server action records the row.
 */
export function QualificationForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(addQualification, null);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const err = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFileError(null);
    const fd = new FormData(event.currentTarget);
    const file = fd.get('file');
    fd.delete('file');

    if (file instanceof File && file.size > 0) {
      const checked = licenseFileSchema.safeParse({ size: file.size, type: file.type });
      if (!checked.success) {
        setFileError(checked.error.issues[0]?.message ?? 'This file cannot be uploaded.');
        return;
      }
      setUploading(true);
      const path = `${userId}/${crypto.randomUUID()}.${LICENSE_FILE_EXTENSIONS[checked.data.type]}`;
      const { error } = await createClient()
        .storage.from(LICENSES_BUCKET)
        .upload(path, file, { contentType: checked.data.type, upsert: false });
      setUploading(false);
      if (error) {
        setFileError(`Upload failed: ${error.message}`);
        return;
      }
      fd.set('document_path', path);
    }

    startTransition(() => action(fd));
  }

  const busy = uploading || pending;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="user_id" value={userId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Type"
          name="type"
          required
          placeholder="e.g. Security licence"
          error={err.type}
        />
        <Field label="Licence number" name="license_number" error={err.license_number} />
        <Field label="Issued on" name="issued_on" type="date" error={err.issued_on} />
        <Field label="Expires on" name="expires_on" type="date" error={err.expires_on} />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Scan (optional, up to 10 MB: JPEG, PNG, HEIC, WebP or PDF)
        </span>
        <input
          type="file"
          name="file"
          accept={LICENSE_FILE_MIME_TYPES.join(',')}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-transparent file:px-3 file:py-1.5 dark:file:border-slate-700"
        />
        {fileError || err.document_path ? (
          <span className="text-red-600 dark:text-red-400">{fileError ?? err.document_path}</span>
        ) : null}
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {uploading ? 'Uploading scan…' : pending ? 'Saving…' : 'Add qualification'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
