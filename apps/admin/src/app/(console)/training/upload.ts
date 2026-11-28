// Browser only: render a lesson PDF's pages with pdf.js (the same helper as
// Forms) and upload the PDF and page images to the private lesson-files
// bucket with the admin's own session, into a new folder
// <lesson_id>/<upload_id>/. The server action then records them.

import { LESSON_FILES_BUCKET } from '@deltaguard/shared';

import { importPdf } from '@/lib/pdf-import';
import { createClient } from '@/lib/supabase/client';
import { consoleError } from '@/lib/errors';

export const LESSON_PDF_MAX_BYTES = 100 * 1024 * 1024;

export function checkLessonPdf(file: File | null): string | null {
  if (!file || file.size === 0) return 'Choose a PDF file.';
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return 'The lesson must be a PDF.';
  }
  if (file.size > LESSON_PDF_MAX_BYTES) return 'The PDF is larger than 100 MB.';
  return null;
}

export async function uploadLessonPdf(
  lessonId: string,
  file: File,
  onProgress: (message: string) => void,
) {
  const { pageCount, pages } = await importPdf(file, onProgress);
  const storage = createClient().storage.from(LESSON_FILES_BUCKET);
  const folder = `${lessonId}/${crypto.randomUUID()}`;

  onProgress('Uploading the PDF…');
  const pdfPath = `${folder}/original.pdf`;
  const pdf = await storage.upload(pdfPath, file, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (pdf.error) throw new Error(consoleError(pdf.error, 'upload the PDF'));

  const paths: string[] = [];
  for (const [i, blob] of pages.entries()) {
    onProgress(`Uploading page ${i + 1} of ${pageCount}…`);
    const path = `${folder}/page-${i + 1}.png`;
    const res = await storage.upload(path, blob, { contentType: 'image/png', upsert: false });
    if (res.error) throw new Error(consoleError(res.error, 'upload the page images'));
    paths.push(path);
  }
  return { lesson_id: lessonId, pdf_path: pdfPath, page_count: pageCount, page_image_paths: paths };
}
