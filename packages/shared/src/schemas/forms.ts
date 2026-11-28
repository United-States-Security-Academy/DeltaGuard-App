import { z } from 'zod';

// Forms (phase 15): PDF templates with fields placed on their pages, assigned
// to officers, filled in on the phone and turned into a signed, flattened PDF
// by the `generate-filled-pdf` Edge Function.
//
// This file imports nothing but zod: the Edge Function imports it directly
// (supabase/functions/generate-filled-pdf/deno.json maps "zod"), so the phone
// and the server validate answers with exactly the same rules.

// Keep in sync with the Postgres enums in the phase 15 migration.
export const FORM_FIELD_TYPES = [
  'text',
  'multiline',
  'number',
  'date',
  'checkbox',
  'select',
  'signature',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_TEMPLATE_STATUSES = ['draft', 'published', 'archived'] as const;
export type FormTemplateStatus = (typeof FORM_TEMPLATE_STATUSES)[number];

export const FORM_SUBMISSION_STATUSES = ['draft', 'submitted', 'returned', 'approved'] as const;
export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

/** Private buckets. Templates: <template_id>/<file>. Submissions: <officer_id>/<submission_id>/<file>. */
export const FORM_TEMPLATES_BUCKET = 'form-templates';
export const FORM_SUBMISSIONS_BUCKET = 'form-submissions';

export const FORM_TEXT_MAX = 500;
export const FORM_MULTILINE_MAX = 5000;

// ---------------------------------------------------------------------------
// Templates and fields (admin)
// ---------------------------------------------------------------------------

export const formTemplateSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200),
  description: z
    .string()
    .trim()
    .max(4000)
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});
export type FormTemplateInput = z.infer<typeof formTemplateSchema>;

const fraction = z.number().min(0).max(1);

/**
 * One field on a template page. x, y, width and height are fractions of the
 * page size, measured from the TOP-left corner of the page as displayed.
 */
export const formFieldSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/, 'Use lowercase letters, digits and _ (start with a letter)'),
    label: z.string().trim().min(1, 'Enter a label').max(200),
    type: z.enum(FORM_FIELD_TYPES),
    /** select: the choices. Other types: null. */
    options: z.array(z.string().trim().min(1).max(200)).min(1).max(100).nullable(),
    required: z.boolean(),
    page: z.number().int().min(1),
    x: fraction,
    y: fraction,
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
    font_size: z.number().min(4).max(72),
    sort_order: z.number().int(),
    acroform_name: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === '' ? null : v))
      .nullable(),
  })
  .refine((f) => f.x + f.width <= 1.0001 && f.y + f.height <= 1.0001, {
    message: 'The field must fit on the page',
    path: ['width'],
  })
  .refine((f) => (f.type === 'select') === (f.options !== null), {
    message: 'Only a choice field has options, and it needs at least one',
    path: ['options'],
  });
export type FormFieldInput = z.infer<typeof formFieldSchema>;

export const formAssignmentSchema = z
  .object({
    template_id: z.uuid(),
    officer_id: z.uuid().nullable(),
    site_id: z.uuid().nullable(),
    role: z.enum(['officer', 'supervisor', 'admin']).nullable(),
    due_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(
    (a) => [a.officer_id, a.site_id, a.role].filter((v) => v !== null).length === 1,
    'Assign to exactly one officer, site or role',
  );
export type FormAssignmentInput = z.infer<typeof formAssignmentSchema>;

export const reviewFormSubmissionSchema = z
  .object({
    p_id: z.uuid(),
    p_status: z.enum(['approved', 'returned']),
    p_notes: z
      .string()
      .trim()
      .max(4000)
      .transform((v) => (v === '' ? null : v))
      .nullable(),
  })
  .refine((r) => r.p_status !== 'returned' || r.p_notes !== null, {
    message: 'Say what needs fixing',
    path: ['p_notes'],
  });

// ---------------------------------------------------------------------------
// Answers (officer, and re-checked by generate-filled-pdf)
// ---------------------------------------------------------------------------

/** The parts of a field the answer rules need. */
export type FormFieldRule = {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: unknown;
};

const optionList = (options: unknown): string[] =>
  Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];

const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function answerSchema(field: FormFieldRule): z.ZodType {
  const name = field.label;
  const text = (max: number) =>
    z
      .string()
      .trim()
      .max(max, `${name}: ${max} characters at most`)
      .transform((v) => (v === '' ? undefined : v));

  let schema: z.ZodType;
  switch (field.type) {
    case 'text':
      schema = text(FORM_TEXT_MAX);
      break;
    case 'multiline':
      schema = text(FORM_MULTILINE_MAX);
      break;
    case 'number':
      schema = z.number(`${name}: enter a number`).finite();
      break;
    case 'date':
      schema = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, `${name}: enter a date`)
        .refine(isRealDate, `${name}: enter a real date`);
      break;
    case 'checkbox':
      schema = z.boolean();
      break;
    case 'select': {
      const choices = optionList(field.options);
      schema = z.string().refine((v) => choices.includes(v), `${name}: choose one of the options`);
      break;
    }
    case 'signature':
      // The signature is a file (form_submissions.signature_path), not a value.
      schema = z.never();
      break;
  }
  // Missing, null and "" all mean "not answered"; a required check follows.
  return z.preprocess((v) => (v === null || v === '' ? undefined : v), schema.optional());
}

/**
 * Validates the `values` of a submission against its template's fields:
 * known keys only, right type per field, every required field answered
 * (an unticked required checkbox counts as unanswered), and a signature when
 * the template has a required signature field. Returns the cleaned values.
 */
export function formValuesSchema(fields: readonly FormFieldRule[], hasSignature: boolean) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    if (field.type !== 'signature') shape[field.key] = answerSchema(field);
  }
  return z.strictObject(shape).superRefine((values, ctx) => {
    for (const field of fields) {
      if (!field.required) continue;
      if (field.type === 'signature') {
        if (!hasSignature)
          ctx.addIssue({ code: 'custom', message: 'Sign the form', path: [field.key] });
        continue;
      }
      const v = (values as Record<string, unknown>)[field.key];
      if (v === undefined || (field.type === 'checkbox' && v !== true)) {
        ctx.addIssue({ code: 'custom', message: `${field.label} is required`, path: [field.key] });
      }
    }
  });
}

/** First problem per field, for showing next to the fields (and in API errors). */
export function formValueProblems(error: z.ZodError): { key: string; message: string }[] {
  const seen = new Set<string>();
  const out: { key: string; message: string }[] = [];
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      message: issue.code === 'unrecognized_keys' ? 'Unknown answers in the form' : issue.message,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Console (phase 15b): labels, field lists, PDF upload
// ---------------------------------------------------------------------------

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Short text',
  multiline: 'Long text',
  number: 'Number',
  date: 'Date',
  checkbox: 'Checkbox',
  select: 'Choice',
  signature: 'Signature',
};

export const FORM_TEMPLATE_STATUS_LABELS: Record<FormTemplateStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

/** Inbox statuses: the submission statuses plus "not started" (assigned, nothing saved). */
export const FORM_INBOX_STATUSES = ['not_started', ...FORM_SUBMISSION_STATUSES] as const;
export type FormInboxStatus = (typeof FORM_INBOX_STATUSES)[number];
export const FORM_INBOX_STATUS_LABELS: Record<FormInboxStatus, string> = {
  not_started: 'Not started',
  draft: 'In progress',
  submitted: 'Waiting for review',
  returned: 'Returned',
  approved: 'Approved',
};

/** A field key from a label or AcroForm name: lowercase, digits and _, starting with a letter. */
export function fieldKeyFrom(text: string, taken: ReadonlySet<string> = new Set()): string {
  let base = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 56);
  if (!/^[a-z]/.test(base)) base = `f_${base}`.replace(/_+$/, '') || 'field';
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** The editor saves the whole list at once. */
export const formFieldListSchema = z
  .array(formFieldSchema)
  .max(300, 'A form can have 300 fields at most')
  .refine((list) => new Set(list.map((f) => f.key)).size === list.length, {
    message: 'Two fields have the same key',
  });

/** After the browser uploaded a PDF and its page images to <template_id>/<upload_id>/. */
export const attachFormPdfSchema = z
  .object({
    template_id: z.uuid(),
    original_pdf_path: z.string().max(500),
    page_count: z.number().int().min(1).max(200),
    page_image_paths: z.array(z.string().max(500)).min(1).max(200),
    /** AcroForm fields found in the PDF, to pre-create. */
    detected_fields: z.array(formFieldSchema).max(300),
  })
  .refine(
    (a) =>
      [a.original_pdf_path, ...a.page_image_paths].every((p) =>
        p.startsWith(`${a.template_id}/`),
      ) && a.page_image_paths.length === a.page_count,
    'The uploaded files are not in this form’s folder',
  );
export type AttachFormPdfInput = z.infer<typeof attachFormPdfSchema>;

export const FORM_PDF_MAX_BYTES = 50 * 1024 * 1024;
