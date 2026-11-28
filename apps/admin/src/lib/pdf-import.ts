// Browser only (imported by client components): reads a PDF with pdf.js,
// renders every page to a PNG for the field editor and the phone, and turns
// the PDF's own AcroForm fields into DeltaGuard fields with their positions.

import { checkFile, fieldKeyFrom, formFieldSchema, type FormFieldInput } from '@deltaguard/shared';
import type * as PdfJsModule from 'pdfjs-dist';

/** Rendered page width in pixels: sharp enough to read small print on a phone. */
const TARGET_WIDTH_PX = 1600;

export type ImportedPdf = {
  pageCount: number;
  pages: Blob[];
  fields: FormFieldInput[];
};

type PdfJs = typeof PdfJsModule;

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads pdf.js once, with its worker as a module worker bundled by Next. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
        { type: 'module' },
      );
    }
    return pdfjs;
  });
  return pdfjsPromise;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** What pdf.js reports for a form widget (the parts we use). */
type Widget = {
  subtype?: string;
  fieldType?: string; // Tx, Btn, Ch, Sig
  fieldName?: string;
  alternativeText?: string;
  rect?: number[];
  hidden?: boolean;
  fieldFlags?: number;
  multiLine?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string;
  options?: { exportValue?: string; displayValue?: string }[];
  defaultAppearanceData?: { fontSize?: number };
};

type Box = { page: number; x: number; y: number; width: number; height: number };

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    page: a.page,
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Same limit as the form-templates and lesson-files buckets. */
const PDF_MAX_BYTES = 20 * 1024 * 1024;

function pdfProblem(reason: string): string {
  if (reason === 'not a PDF' || reason.includes('end-of-file')) return 'This file is not a PDF.';
  if (reason.includes('encrypted')) {
    return 'This PDF is password-protected. Remove the password and upload it again.';
  }
  return 'This PDF contains scripts, attachments or other active content, so it can’t be used. Print it to a new PDF (File → Print → Save as PDF) and upload that.';
}

export async function importPdf(
  file: File,
  onProgress: (message: string) => void,
): Promise<ImportedPdf> {
  if (file.size > PDF_MAX_BYTES) throw new Error('The PDF is too large (20 MB max).');
  const data = new Uint8Array(await file.arrayBuffer());
  // By content, not by name: a real PDF with no JavaScript, launch actions,
  // attachments or encryption (the server checks again after upload).
  const checked = await checkFile('upload.pdf', data);
  if (!checked.ok) throw new Error(pdfProblem(checked.reason));
  const pdfjs = await loadPdfJs();
  const loading = pdfjs.getDocument({ data });
  let doc;
  try {
    doc = await loading.promise;
  } catch (e) {
    const name = (e as Error)?.name;
    throw new Error(
      name === 'PasswordException'
        ? 'This PDF is password-protected. Remove the password and upload it again.'
        : 'This file could not be read as a PDF.',
    );
  }

  const pages: Blob[] = [];
  // One entry per AcroForm field name (a field can have several widgets).
  const found = new Map<string, { widget: Widget; box: Box; values: string[] }>();

  for (let n = 1; n <= doc.numPages; n += 1) {
    onProgress(`Reading page ${n} of ${doc.numPages}…`);
    const page = await doc.getPage(n);

    // Page image (rotation is applied, as the page is displayed).
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, Math.max(1, TARGET_WIDTH_PX / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not draw the PDF.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Your browser could not save a page image.');
    pages.push(blob);

    // AcroForm widgets, as fractions of the displayed page from the top-left.
    const annotations = (await page.getAnnotations()) as Widget[];
    for (const a of annotations) {
      if (a.subtype !== 'Widget' || !a.fieldName || !a.rect || a.hidden || a.pushButton) continue;
      const [x1, y1, x2, y2] = a.rect as [number, number, number, number];
      const [ax, ay] = base.convertToViewportPoint(x1, y1) as [number, number];
      const [bx, by] = base.convertToViewportPoint(x2, y2) as [number, number];
      const left = clamp01(Math.min(ax, bx) / base.width);
      const top = clamp01(Math.min(ay, by) / base.height);
      const box: Box = {
        page: n,
        x: left,
        y: top,
        width: Math.max(0.005, clamp01(Math.max(ax, bx) / base.width) - left),
        height: Math.max(0.005, clamp01(Math.max(ay, by) / base.height) - top),
      };
      const existing = found.get(a.fieldName);
      if (existing) {
        // Radio buttons: one widget per choice; merge into one choice field.
        if (a.radioButton && existing.box.page === n) {
          existing.box = union(existing.box, box);
          if (a.buttonValue) existing.values.push(a.buttonValue);
        }
        continue;
      }
      found.set(a.fieldName, {
        widget: a,
        box,
        values: a.radioButton && a.buttonValue ? [a.buttonValue] : [],
      });
    }
    page.cleanup();
  }
  const pageCount = doc.numPages;
  await loading.destroy();

  const taken = new Set<string>();
  const fields: FormFieldInput[] = [];
  for (const [name, { widget: w, box, values }] of found) {
    let type: FormFieldInput['type'] = 'text';
    let options: string[] | null = null;
    if (w.fieldType === 'Sig') type = 'signature';
    else if (w.fieldType === 'Tx') type = w.multiLine ? 'multiline' : 'text';
    else if (w.fieldType === 'Btn' && w.checkBox) type = 'checkbox';
    else if (w.fieldType === 'Btn' && w.radioButton) {
      type = 'select';
      options = [...new Set(values.filter(Boolean))].slice(0, 100);
    } else if (w.fieldType === 'Ch') {
      type = 'select';
      options = [
        ...new Set(
          (w.options ?? [])
            .map((o) => (o.displayValue ?? o.exportValue ?? '').trim())
            .filter(Boolean)
            .map((o) => o.slice(0, 200)),
        ),
      ].slice(0, 100);
    } else continue;
    if (type === 'select' && (options?.length ?? 0) === 0) {
      type = 'text';
      options = null;
    }

    const key = fieldKeyFrom(name, taken);
    taken.add(key);
    const fontSize = w.defaultAppearanceData?.fontSize;
    const candidate = {
      key,
      label: (w.alternativeText?.trim() || name).slice(0, 200),
      type,
      options,
      required: ((w.fieldFlags ?? 0) & 2) !== 0,
      ...box,
      font_size: fontSize && fontSize >= 4 && fontSize <= 72 ? fontSize : 10,
      sort_order: fields.length,
      acroform_name: name.slice(0, 200),
    };
    const parsed = formFieldSchema.safeParse(candidate);
    if (parsed.success) fields.push(parsed.data);
  }

  // Reading order: page, then top to bottom, then left to right.
  fields.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  fields.forEach((f, i) => (f.sort_order = i));

  return { pageCount, pages, fields };
}
