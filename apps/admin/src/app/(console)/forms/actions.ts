'use server';

import {
  attachFormPdfSchema,
  fieldKeyFrom,
  FORM_TEMPLATES_BUCKET,
  formAssignmentSchema,
  type FormFieldInput,
  formFieldListSchema,
  formTemplateSchema,
  fromZoned,
  recordIdSchema,
  reviewFormSubmissionSchema,
} from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin, requireStaff } from '@/lib/auth';
import { text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../schedule/data';

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Every write runs as the signed-in admin (RLS + the table triggers decide);
// no service role here.

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type CreateFormResult =
  { ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** Step 1 of "New form": the draft row (the browser then uploads the PDF into its folder). */
export async function createFormTemplate(input: {
  title: string;
  description: string;
}): Promise<CreateFormResult> {
  await requireAdmin();
  const parsed = formTemplateSchema.safeParse(input);
  if (!parsed.success) {
    const state = invalid(parsed.error);
    return { ok: false, message: state!.message, fieldErrors: state!.fieldErrors };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('form_templates')
    .insert(parsed.data)
    .select('id')
    .single();
  if (error) return failed(error);
  return { ok: true, id: data.id };
}

/** Paths a published version still uses (never deleted). */
async function pathsInVersions(supabase: Supabase, templateId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('form_template_versions')
    .select('original_pdf_path, page_image_paths')
    .eq('template_id', templateId);
  return new Set((data ?? []).flatMap((v) => [v.original_pdf_path, ...v.page_image_paths]));
}

/**
 * Step 2: record the PDF and page images the browser uploaded. New forms get
 * the PDF's AcroForm fields; a replaced PDF keeps the fields already placed
 * and adds AcroForm fields that aren't mapped yet. Files of the previous
 * upload are deleted unless a published version still uses them.
 */
export async function attachFormPdf(input: unknown): Promise<ActionState> {
  await requireAdmin();
  const parsed = attachFormPdfSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid upload' };
  const a = parsed.data;
  const supabase = await createClient();

  const [{ data: template }, { data: existing }] = await Promise.all([
    supabase
      .from('form_templates')
      .select('original_pdf_path, page_image_paths, status')
      .eq('id', a.template_id)
      .maybeSingle(),
    supabase
      .from('form_fields')
      .select(
        'key, label, type, options, required, page, x, y, width, height, font_size, sort_order, acroform_name',
      )
      .eq('template_id', a.template_id)
      .order('sort_order'),
  ]);
  if (!template) return { ok: false, message: 'Form not found.' };
  if (template.status === 'archived') return { ok: false, message: 'Restore the form first.' };

  const { error } = await supabase
    .from('form_templates')
    .update({
      original_pdf_path: a.original_pdf_path,
      page_count: a.page_count,
      page_image_paths: a.page_image_paths,
    })
    .eq('id', a.template_id);
  if (error) return failed(error);

  // Fields: keep what is placed, add AcroForm fields not mapped yet.
  const current = (existing ?? []) as FormFieldInput[];
  const mapped = new Set(current.map((f) => f.acroform_name).filter(Boolean));
  const taken = new Set(current.map((f) => f.key));
  const added: FormFieldInput[] = [];
  for (const f of a.detected_fields) {
    if (f.acroform_name && mapped.has(f.acroform_name)) continue;
    const key = taken.has(f.key) ? fieldKeyFrom(f.key, taken) : f.key;
    taken.add(key);
    added.push({ ...f, key, sort_order: current.length + added.length });
  }
  if (added.length > 0) {
    const { error: fieldsError } = await supabase.rpc('replace_form_fields', {
      p_template_id: a.template_id,
      p_fields: [...current, ...added],
    });
    if (fieldsError) return failed(fieldsError);
  }

  // Remove the previous upload's files unless a published version uses them.
  const old = [template.original_pdf_path, ...template.page_image_paths].filter(
    (p): p is string => !!p && ![a.original_pdf_path, ...a.page_image_paths].includes(p),
  );
  if (old.length > 0) {
    const keep = await pathsInVersions(supabase, a.template_id);
    const remove = old.filter((p) => !keep.has(p));
    if (remove.length > 0) await supabase.storage.from(FORM_TEMPLATES_BUCKET).remove(remove);
  }

  const outside = current.filter((f) => f.page > a.page_count).length;
  refresh();
  return {
    ok: true,
    message: [
      `PDF saved (${a.page_count} page${a.page_count === 1 ? '' : 's'}).`,
      added.length
        ? `${added.length} field${added.length === 1 ? '' : 's'} found in the PDF were added.`
        : '',
      outside
        ? `${outside} field${outside === 1 ? ' is' : 's are'} on pages this PDF doesn’t have: move or delete ${outside === 1 ? 'it' : 'them'}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export type SaveFieldsResult = { ok: boolean; message: string; problems?: Record<number, string> };

/** The editor saves the whole field list in one transaction (replace_form_fields). */
export async function saveFormFields(
  templateId: string,
  fields: unknown,
): Promise<SaveFieldsResult> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: templateId });
  if (!id.success) return { ok: false, message: 'Form not found.' };
  const parsed = formFieldListSchema.safeParse(fields);
  if (!parsed.success) {
    const problems: Record<number, string> = {};
    for (const issue of parsed.error.issues) {
      const index = typeof issue.path[0] === 'number' ? issue.path[0] : -1;
      if (index >= 0) problems[index] ??= `${String(issue.path[1] ?? '')}: ${issue.message}`;
    }
    return {
      ok: false,
      message:
        parsed.error.issues.find((i) => i.path.length === 0)?.message ?? 'Some fields need fixing.',
      problems,
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('replace_form_fields', {
    p_template_id: id.data.id,
    p_fields: parsed.data.map((f, i) => ({ ...f, sort_order: i })),
  });
  if (error) return failed(error);
  refresh();
  return {
    ok: true,
    message: `Saved ${parsed.data.length} field${parsed.data.length === 1 ? '' : 's'}.`,
  };
}

export async function publishFormTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Form not found.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('publish_form_template', { p_id: id.data.id });
  if (error) return failed(error);
  refresh();
  return { ok: true, message: `Published version ${data}.` };
}

export async function updateFormDetails(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  const parsed = formTemplateSchema.safeParse({
    title: text(fd, 'title') ?? '',
    description: text(fd, 'description') ?? '',
  });
  if (!id.success) return { ok: false, message: 'Form not found.' };
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from('form_templates').update(parsed.data).eq('id', id.data.id);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Saved. Publish to make the change visible to officers.' };
}

/** Archive (officers stop seeing it) or restore (the last published version comes back). */
export async function setFormArchived(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Form not found.' };
  const archive = text(fd, 'archive') === 'true';
  const supabase = await createClient();
  const { error } = await supabase
    .from('form_templates')
    .update({ status: archive ? 'archived' : 'published' })
    .eq('id', id.data.id);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: archive ? 'Archived.' : 'Restored.' };
}

/** A form that was never published can be deleted, with its files. */
export async function deleteDraftForm(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Form not found.' };
  const supabase = await createClient();
  const { data: template } = await supabase
    .from('form_templates')
    .select('status, version')
    .eq('id', id.data.id)
    .maybeSingle();
  if (!template) return { ok: false, message: 'Form not found.' };
  if (template.status !== 'draft' || template.version > 0) {
    return {
      ok: false,
      message: 'Only a form that was never published can be deleted. Archive it instead.',
    };
  }

  const storage = supabase.storage.from(FORM_TEMPLATES_BUCKET);
  const { data: folders } = await storage.list(id.data.id);
  const files: string[] = [];
  for (const folder of folders ?? []) {
    const { data: inside } = await storage.list(`${id.data.id}/${folder.name}`);
    for (const f of inside ?? []) files.push(`${id.data.id}/${folder.name}/${f.name}`);
  }
  const { error } = await supabase.from('form_templates').delete().eq('id', id.data.id);
  if (error) return failed(error);
  if (files.length > 0) await storage.remove(files);
  redirect('/forms');
}

// ---------------------------------------------------------------------------
// Assignments (the database notifies everyone they reach)
// ---------------------------------------------------------------------------

export async function createFormAssignment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const target = text(fd, 'target');
  const dueDate = text(fd, 'due_date');
  const dueTime = text(fd, 'due_time') ?? '23:59';
  const supabase = await createClient();

  let dueAt: string | null = null;
  if (dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{2}:\d{2}$/.test(dueTime)) {
      return {
        ok: false,
        message: 'Enter a valid due date.',
        fieldErrors: { due_date: 'Invalid date' },
      };
    }
    dueAt = fromZoned(dueDate, dueTime, await getTimeZone(supabase)).toISOString();
    if (Date.parse(dueAt) < Date.now()) {
      return {
        ok: false,
        message: 'The due date is in the past.',
        fieldErrors: { due_date: 'In the past' },
      };
    }
  }

  const parsed = formAssignmentSchema.safeParse({
    template_id: text(fd, 'template_id'),
    officer_id: target === 'officer' ? text(fd, 'officer_id') : null,
    site_id: target === 'site' ? text(fd, 'site_id') : null,
    role: target === 'role' ? text(fd, 'role') : null,
    due_at: dueAt,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Choose who should fill in this form.',
      fieldErrors: { target: 'Required' },
    };
  }

  const { error } = await supabase.from('form_assignments').insert(parsed.data);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Assigned. Everyone it reaches gets a notification on their phone.' };
}

export async function deleteFormAssignment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return { ok: false, message: 'Assignment not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('form_assignments').delete().eq('id', id.data.id);
  if (error) return failed(error);
  refresh();
  return { ok: true, message: 'Assignment removed.' };
}

// ---------------------------------------------------------------------------
// Review (admins, and supervisors for their sites; the officer is notified)
// ---------------------------------------------------------------------------

export async function reviewFormSubmission(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = reviewFormSubmissionSchema.safeParse({
    p_id: text(fd, 'id'),
    p_status: text(fd, 'status'),
    p_notes: text(fd, 'notes') ?? '',
  });
  if (!parsed.success) {
    const state = invalid(parsed.error);
    return {
      ok: false,
      message: state!.message,
      fieldErrors: { notes: state!.fieldErrors?.p_notes ?? '' },
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_form_submission', {
    p_id: parsed.data.p_id,
    p_status: parsed.data.p_status,
    p_notes: parsed.data.p_notes ?? undefined,
  });
  if (error) return failed(error);
  refresh();
  return {
    ok: true,
    message:
      parsed.data.p_status === 'approved'
        ? 'Approved. The officer was notified.'
        : 'Returned. The officer was notified.',
  };
}
