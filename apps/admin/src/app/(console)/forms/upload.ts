// Browser only: upload a PDF and its page images to the private
// form-templates bucket with the admin's own session (storage RLS: admins
// only), into a NEW folder <template_id>/<upload_id>/ so files of published
// versions are never overwritten. Then the server action records them.

import {
  type AttachFormPdfInput,
  FORM_PDF_MAX_BYTES,
  FORM_TEMPLATES_BUCKET,
} from '@deltaguard/shared';

import { createClient } from '@/lib/supabase/client';

import { importPdf } from '@/lib/pdf-import';
import { consoleError } from '@/lib/errors';

export function checkPdfFile(file: File | null): string | null {
  if (!file || file.size === 0) return 'Choose a PDF file.';
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return 'The form must be a PDF.';
  }
  if (file.size > FORM_PDF_MAX_BYTES) return 'The PDF is larger than 50 MB.';
  return null;
}

export async function uploadFormPdf(
  templateId: string,
  file: File,
  onProgress: (message: string) => void,
): Promise<AttachFormPdfInput> {
  const imported = await importPdf(file, onProgress);
  const storage = createClient().storage.from(FORM_TEMPLATES_BUCKET);
  const folder = `${templateId}/${crypto.randomUUID()}`;

  onProgress('Uploading the PDF…');
  const pdfPath = `${folder}/original.pdf`;
  const pdf = await storage.upload(pdfPath, file, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (pdf.error) throw new Error(consoleError(pdf.error, 'upload the PDF'));

  const pagePaths: string[] = [];
  for (const [i, blob] of imported.pages.entries()) {
    onProgress(`Uploading page ${i + 1} of ${imported.pageCount}…`);
    const path = `${folder}/page-${i + 1}.png`;
    const res = await storage.upload(path, blob, { contentType: 'image/png', upsert: false });
    if (res.error) throw new Error(consoleError(res.error, 'upload the page images'));
    pagePaths.push(path);
  }

  return {
    template_id: templateId,
    original_pdf_path: pdfPath,
    page_count: imported.pageCount,
    page_image_paths: pagePaths,
    detected_fields: imported.fields,
  };
}
