// generate-filled-pdf: submits an officer's form (phase 15).
//
// POST { "submission_id": "<uuid>" } with the officer's own access token.
//
//  1. Reads the submission and the template's current PUBLISHED VERSION
//     (form_template_versions: frozen PDF + fields) WITH THE OFFICER'S TOKEN,
//     so RLS decides: only their own submission, only a published template
//     that is assigned to them. The submission must be draft or returned.
//  2. Validates the answers with the shared Zod schema (formValuesSchema in
//     packages/shared/src/schemas/forms.ts), the same rules as the phone.
//  3. Loads the original PDF with pdf-lib. A field with acroform_name fills
//     that AcroForm field; otherwise its text is drawn at the stored position
//     (fractions of the page, from the top-left of the page as displayed).
//     The signature PNG is drawn in every signature field.
//  4. Adds a footer on the last page (officer name, employee number, signing
//     date and time in the company time zone, submission id), flattens the
//     form, uploads the PDF to form-submissions and records its SHA-256.
//  5. complete_form_submission() (service role only) marks it submitted, and
//     refuses if the answers changed while the PDF was being made.
//
// Deployed with verify_jwt = false (supabase/config.toml); the token is
// checked here, including the live profile (suspended users are refused).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  degrees,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  type PDFFont,
  type PDFForm,
  type PDFImage,
  PDFOptionList,
  type PDFPage,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  rgb,
  StandardFonts,
} from 'npm:pdf-lib@1.17.1';
import { z } from 'zod';

import { checkFile } from '../_shared/image-check.ts';

import {
  FORM_SUBMISSIONS_BUCKET,
  FORM_TEMPLATES_BUCKET,
  type FormFieldRule,
  formValueProblems,
  formValuesSchema,
} from '../../../packages/shared/src/schemas/forms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Field = FormFieldRule & {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
  acroform_name: string | null;
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

// ---------------------------------------------------------------------------
// Caller
// ---------------------------------------------------------------------------

async function caller(request: Request): Promise<{ userId: string; token: string }> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sign in again');
  const { data, error } = await admin.auth.getClaims(token);
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || typeof claims?.sub !== 'string' || claims.employment_status !== 'active') {
    throw new HttpError(401, 'Sign in again');
  }
  // The token can be up to an hour old: the live profile must still be active.
  const { data: profile } = await admin
    .from('profiles')
    .select('employment_status')
    .eq('id', claims.sub)
    .maybeSingle();
  if (profile?.employment_status !== 'active') throw new HttpError(403, 'Not allowed');
  return { userId: claims.sub, token };
}

// ---------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------

/** The standard PDF fonts only cover Western European (WinAnsi) characters. */
function cleaner(font: PDFFont) {
  const cache = new Map<string, boolean>();
  return (text: string) =>
    Array.from(text.replace(/\t/g, '    ').replace(/\r\n?/g, '\n'))
      .map((ch) => {
        if (ch === '\n') return ch;
        let ok = cache.get(ch);
        if (ok === undefined) {
          try {
            font.widthOfTextAtSize(ch, 10);
            ok = true;
          } catch {
            ok = false;
          }
          cache.set(ch, ok);
        }
        return ok ? ch : '?';
      })
      .join('');
}

/**
 * Page geometry as displayed (after /Rotate), and a mapping from display
 * coordinates (origin top-left, y down, in points) to PDF user space.
 */
function view(page: PDFPage) {
  const box = page.getMediaBox();
  const rotation = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  const toPdf = (u: number, v: number) => {
    switch (rotation) {
      case 90:
        return { x: box.x + v, y: box.y + u };
      case 180:
        return { x: box.x + box.width - u, y: box.y + v };
      case 270:
        return { x: box.x + box.width - v, y: box.y + box.height - u };
      default:
        return { x: box.x + u, y: box.y + box.height - v };
    }
  };
  return { width, height, rotate: degrees(rotation), toPdf };
}

/** Text starting at display point (u, baseline v), upright as displayed. */
function drawLine(page: PDFPage, text: string, u: number, v: number, font: PDFFont, size: number) {
  const g = view(page);
  const at = g.toPdf(u, v);
  page.drawText(text, { ...at, font, size, color: rgb(0, 0, 0), rotate: g.rotate });
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function ellipsize(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Answer as printed: dates as MM/DD/YYYY (US), checkboxes as X. */
function display(field: Field, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (field.type === 'checkbox') return value === true ? 'X' : null;
  if (field.type === 'date' && typeof value === 'string') {
    const [y, m, d] = value.split('-');
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

/** Draws an answer inside its box. */
function drawAnswer(page: PDFPage, field: Field, text: string, font: PDFFont) {
  const g = view(page);
  const box = {
    u: field.x * g.width,
    v: field.y * g.height,
    w: field.width * g.width,
    h: field.height * g.height,
  };
  const pad = Math.min(2, box.w * 0.05);
  const maxWidth = Math.max(1, box.w - 2 * pad);

  if (field.type === 'checkbox') {
    const size = Math.max(4, Math.min(box.w, box.h) * 0.8);
    const tw = font.widthOfTextAtSize(text, size);
    drawLine(page, text, box.u + (box.w - tw) / 2, box.v + (box.h + size * 0.7) / 2, font, size);
    return;
  }

  if (field.type === 'multiline') {
    let size = field.font_size;
    let lines = wrap(text, font, size, maxWidth);
    while (size > 5 && lines.length * size * 1.2 > box.h) {
      size -= 0.5;
      lines = wrap(text, font, size, maxWidth);
    }
    const fit = Math.max(1, Math.floor(box.h / (size * 1.2)));
    if (lines.length > fit) {
      lines = lines.slice(0, fit);
      lines[fit - 1] = ellipsize(`${lines[fit - 1]}…`, font, size, maxWidth);
    }
    lines.forEach((line, i) =>
      drawLine(page, line, box.u + pad, box.v + size * (1.2 * i + 1), font, size),
    );
    return;
  }

  // One line: shrink to fit the box (down to 5 pt), then cut with an ellipsis.
  let size = Math.min(field.font_size, box.h * 0.85);
  while (size > 5 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  const line = ellipsize(text, font, size, maxWidth);
  drawLine(page, line, box.u + pad, box.v + (box.h + size * 0.7) / 2, font, size);
}

/** The signature, kept in proportion and centred in the box. */
function drawSignature(
  page: PDFPage,
  image: PDFImage,
  box: { u: number; v: number; w: number; h: number },
) {
  const g = view(page);
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const u = box.u + (box.w - w) / 2;
  const v = box.v + (box.h - h) / 2;
  // Anchor = bottom-left corner of the image as displayed.
  page.drawImage(image, { ...g.toPdf(u, v + h), width: w, height: h, rotate: g.rotate });
}

/** Fills an AcroForm field. False when there is no such field or it can't take this answer. */
function fillAcroField(form: PDFForm, field: Field, value: unknown, clean: (s: string) => string) {
  const target = form.getFieldMaybe(field.acroform_name!);
  if (!target) return false;
  try {
    if (target instanceof PDFCheckBox) {
      if (value === true) target.check();
      else target.uncheck();
      return true;
    }
    const text = display(field, value);
    if (target instanceof PDFTextField) {
      const t = clean(text ?? '');
      const max = target.getMaxLength();
      target.setText(max !== undefined ? t.slice(0, max) : t);
      return true;
    }
    if (target instanceof PDFDropdown || target instanceof PDFOptionList) {
      if (text === null) target.clear();
      else target.select(clean(text));
      return true;
    }
    if (target instanceof PDFRadioGroup) {
      if (text === null) target.clear();
      else target.select(clean(text));
      return true;
    }
  } catch {
    // e.g. a choice the PDF doesn't list: draw it instead.
  }
  return false;
}

/** Where an AcroForm field's first widget sits, as a display box on its page. */
function acroBox(pdf: PDFDocument, form: PDFForm, name: string) {
  const target = form.getFieldMaybe(name);
  const widget = target?.acroField.getWidgets()[0];
  if (!target || !widget) return null;
  const ref = pdf.context.getObjectRef(widget.dict);
  const page = ref ? pdf.findPageForAnnotationRef(ref) : undefined;
  if (!page) return null;
  const r = widget.getRectangle();
  const g = view(page);
  const box = page.getMediaBox();
  // Only unrotated pages map simply; others fall back to the stored position.
  if (page.getRotation().angle % 360 !== 0) return null;
  return {
    page,
    box: { u: r.x - box.x, v: g.height - (r.y - box.y) - r.height, w: r.width, h: r.height },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(client: SupabaseClient, bucket: string, path: string, what: string) {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) throw new HttpError(422, `The ${what} could not be found. Try again`);
  return new Uint8Array(await data.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function submit(submissionId: string, userId: string, token: string) {
  // Reads as the officer: RLS only shows their own submission and templates
  // that are published and assigned to them.
  const asOfficer = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: submission } = await asOfficer
    .from('form_submissions')
    .select('id, template_id, officer_id, status, values, signature_path')
    .eq('id', submissionId)
    .maybeSingle();
  if (!submission || submission.officer_id !== userId) {
    throw new HttpError(404, 'Form not found');
  }
  if (submission.status !== 'draft' && submission.status !== 'returned') {
    throw new HttpError(409, 'This form was already submitted');
  }

  const { data: template } = await asOfficer
    .from('form_templates')
    .select('id, status, version')
    .eq('id', submission.template_id)
    .maybeSingle();
  if (!template || template.status !== 'published' || template.version < 1) {
    throw new HttpError(409, 'This form is no longer available. Ask your supervisor');
  }

  // The frozen published version (phase 15b), never the admin's working copy.
  const { data: published } = await asOfficer
    .from('form_template_versions')
    .select('title, original_pdf_path, fields')
    .eq('template_id', template.id)
    .eq('version', template.version)
    .maybeSingle();
  if (!published) throw new HttpError(409, 'This form is no longer available. Ask your supervisor');
  const fields = (Array.isArray(published.fields) ? published.fields : []) as unknown as Field[];

  // Validate exactly what is stored (the phone checks the same rules).
  const parsed = formValuesSchema(fields, submission.signature_path !== null).safeParse(
    submission.values,
  );
  if (!parsed.success) {
    throw new HttpError(422, 'Some answers need fixing', {
      problems: formValueProblems(parsed.error),
    });
  }
  const values = parsed.data as Record<string, unknown>;

  const [pdfBytes, signatureBytes] = await Promise.all([
    download(asOfficer, FORM_TEMPLATES_BUCKET, published.original_pdf_path, 'form PDF'),
    submission.signature_path
      ? download(asOfficer, FORM_SUBMISSIONS_BUCKET, submission.signature_path, 'signature')
      : Promise.resolve(null),
  ]);

  // Officer details for the footer (officers can't read other people's rows,
  // but these are the caller's own; read with the service role for simplicity).
  const [{ data: profile }, { data: details }, { data: settings }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    admin.from('officer_details').select('employee_number').eq('user_id', userId).maybeSingle(),
    admin.from('settings').select('time_zone').eq('id', true).maybeSingle(),
  ]);

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(pdfBytes);
  } catch {
    throw new HttpError(422, 'The form PDF can’t be filled (it may be protected). Tell your admin');
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const clean = cleaner(font);
  const pages = pdf.getPages();
  const form = pdf.getForm();
  let signature: PDFImage | null = null;
  // The signature may still be waiting for verify-upload: check it here too.
  if (signatureBytes && !(await checkFile(submission.signature_path!, signatureBytes)).ok) {
    throw new HttpError(422, 'The signature image is damaged. Sign again');
  }
  if (signatureBytes) {
    try {
      signature = await pdf.embedPng(signatureBytes);
    } catch {
      throw new HttpError(422, 'The signature image is damaged. Sign again');
    }
  }

  for (const field of fields) {
    const page = pages[field.page - 1];

    if (field.type === 'signature') {
      if (!signature) continue;
      const acro = field.acroform_name ? acroBox(pdf, form, field.acroform_name) : null;
      if (acro) {
        drawSignature(acro.page, signature, acro.box);
      } else if (page) {
        const g = view(page);
        drawSignature(page, signature, {
          u: field.x * g.width,
          v: field.y * g.height,
          w: field.width * g.width,
          h: field.height * g.height,
        });
      }
      continue;
    }

    const value = values[field.key];
    if (field.acroform_name && fillAcroField(form, field, value, clean)) continue;
    const text = display(field, value);
    if (text !== null && page) drawAnswer(page, field, clean(text), font);
  }

  // Footer on the last page: who signed, when (server time), which submission.
  const signedAt = new Date();
  const timeZone = settings?.time_zone || 'UTC';
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(signedAt);
  const name = profile?.full_name?.trim() || 'Unknown officer';
  const lines = [
    clean(
      `Signed electronically by ${name} (employee no. ${details?.employee_number ?? 'not set'}) on ${when}.`,
    ),
    clean(
      `DeltaGuard submission ${submission.id} · ${published.title} (version ${template.version})`,
    ),
  ];
  const last = pages[pages.length - 1]!;
  const g = view(last);
  const size = 7;
  const maxWidth = g.width - 48;
  const strip = size * 1.3 * lines.length + 8;
  const corner = g.toPdf(0, g.height);
  last.drawRectangle({
    ...corner,
    width: g.width,
    height: strip,
    color: rgb(1, 1, 1),
    opacity: 0.85,
    rotate: g.rotate,
  });
  lines.forEach((line, i) =>
    drawLine(
      last,
      ellipsize(line, font, size, maxWidth),
      24,
      g.height - strip + 4 + size * (1.3 * i + 1),
      font,
      size,
    ),
  );

  // Flatten: answers become part of the page and can't be edited. Signature
  // fields (now drawn over) and widgets without an appearance can't be
  // flattened by pdf-lib, so they are removed first.
  for (const f of form.getFields()) {
    if (f instanceof PDFSignature) {
      try {
        form.removeField(f);
      } catch {
        // Left for the second pass below.
      }
    }
  }
  try {
    form.updateFieldAppearances(font);
    form.flatten();
  } catch {
    for (const f of form.getFields()) {
      if (f.acroField.getWidgets().some((w) => !w.getAppearances())) {
        try {
          form.removeField(f);
        } catch {
          // Ignore: flatten below reports if it still fails.
        }
      }
    }
    try {
      form.flatten();
    } catch {
      throw new HttpError(500, 'The form PDF could not be completed. Tell your admin');
    }
  }

  pdf.setTitle(published.title);
  pdf.setProducer('DeltaGuard');
  pdf.setModificationDate(signedAt);
  const out = await pdf.save();
  const hash = await sha256Hex(out);

  const path = `${userId}/${submission.id}/filled-${signedAt.getTime()}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(FORM_SUBMISSIONS_BUCKET)
    .upload(path, out, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw new HttpError(502, 'Could not save the PDF. Try again');

  const { data: done, error } = await admin.rpc('complete_form_submission', {
    p_id: submission.id,
    p_expected_values: submission.values,
    p_expected_signature_path: submission.signature_path,
    p_template_version: template.version,
    p_signed_at: signedAt.toISOString(),
    p_pdf_path: path,
    p_sha256: hash,
  });
  if (error) {
    await admin.storage.from(FORM_SUBMISSIONS_BUCKET).remove([path]);
    const status = error.code === '40001' || error.code === 'P0001' ? 409 : 500;
    throw new HttpError(status, status === 409 ? error.message : 'Could not submit the form');
  }
  return done;
}

const requestSchema = z.object({ submission_id: z.string().regex(UUID) });

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST');
    const { userId, token } = await caller(request);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'submission_id is required');
    const submission = await submit(parsed.data.submission_id, userId, token);
    return json({ submission });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
    console.error('generate-filled-pdf:', err);
    return json({ error: 'Could not submit the form' }, 500);
  }
});
