import {
  FORM_SUBMISSIONS_BUCKET,
  FORM_TEMPLATES_BUCKET,
  type FormSubmissionStatus,
  SIGNED_URL_MAX_SECONDS,
} from '@deltaguard/shared';
import { useQuery } from '@tanstack/react-query';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'react-native';

import {
  cacheVersion,
  type CachedVersion,
  latestCachedVersion,
  type LocalForm,
  readCachedVersion,
  type VersionField,
} from './form-store';
import { supabase } from './supabase';

export const formKeys = {
  all: ['forms'] as const,
  mine: (userId: string) => ['forms', 'mine', userId] as const,
  version: (templateId: string, version: number | 'current') =>
    ['forms', 'version', templateId, version] as const,
  submission: (id: string) => ['forms', 'submission', id] as const,
};

export type ServerSubmission = {
  id: string;
  templateId: string;
  templateVersion: number;
  assignmentId: string | null;
  status: FormSubmissionStatus;
  values: Record<string, unknown>;
  signaturePath: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  hasPdf: boolean;
  /** null when the form was archived (officers can no longer read it). */
  title: string | null;
};

export type Assignment = {
  id: string;
  templateId: string;
  title: string;
  description: string | null;
  version: number;
  dueAt: string | null;
  createdAt: string;
};

const SUBMISSION_COLUMNS = `id, template_id, template_version, assignment_id, status, values,
  signature_path, submitted_at, reviewed_at, review_notes, filled_pdf_path,
  form_templates(title)`;

type SubmissionRow = {
  id: string;
  template_id: string;
  template_version: number;
  assignment_id: string | null;
  status: FormSubmissionStatus;
  values: unknown;
  signature_path: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  filled_pdf_path: string | null;
  form_templates: { title: string } | null;
};

function toSubmission(r: SubmissionRow): ServerSubmission {
  return {
    id: r.id,
    templateId: r.template_id,
    templateVersion: r.template_version,
    assignmentId: r.assignment_id,
    status: r.status,
    values:
      typeof r.values === 'object' && r.values !== null && !Array.isArray(r.values)
        ? (r.values as Record<string, unknown>)
        : {},
    signaturePath: r.signature_path,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewNotes: r.review_notes,
    hasPdf: r.filled_pdf_path !== null,
    title: r.form_templates?.title ?? null,
  };
}

/** Assignments that reach me (RLS: directly, via my site, or via my role) and my submissions. */
export function useMyForms(userId: string) {
  return useQuery({
    queryKey: formKeys.mine(userId),
    queryFn: async () => {
      const [assignments, submissions] = await Promise.all([
        supabase
          .from('form_assignments')
          .select(
            'id, template_id, due_at, created_at, form_templates(title, description, version, status)',
          )
          .order('due_at', { ascending: true, nullsFirst: false }),
        supabase
          .from('form_submissions')
          .select(SUBMISSION_COLUMNS)
          .eq('officer_id', userId)
          .order('updated_at', { ascending: false })
          .limit(200),
      ]);
      if (assignments.error) throw assignments.error;
      if (submissions.error) throw submissions.error;
      return {
        assignments: assignments.data.flatMap((a): Assignment[] =>
          a.form_templates && a.form_templates.status === 'published'
            ? [
                {
                  id: a.id,
                  templateId: a.template_id,
                  title: a.form_templates.title,
                  description: a.form_templates.description,
                  version: a.form_templates.version,
                  dueAt: a.due_at,
                  createdAt: a.created_at,
                },
              ]
            : [],
        ),
        submissions: (submissions.data as unknown as SubmissionRow[]).map(toSubmission),
      };
    },
  });
}

export type MyFormLists = {
  /** Assigned and not submitted yet (including drafts), soonest due first. */
  todo: {
    key: string;
    title: string;
    dueAt: string | null;
    assignment: Assignment | null;
    server: ServerSubmission | null;
    local: LocalForm | null;
  }[];
  /** Sent back by a reviewer. */
  returned: { server: ServerSubmission; local: LocalForm | null }[];
  /** Submitted (waiting for review) or approved; plus forms waiting in the offline queue. */
  submitted: { server: ServerSubmission | null; local: LocalForm | null }[];
};

/** Merges server data with forms on this phone into the three lists. */
export function buildLists(
  data: { assignments: Assignment[]; submissions: ServerSubmission[] } | undefined,
  locals: LocalForm[],
): MyFormLists {
  const assignments = data?.assignments ?? [];
  const submissions = data?.submissions ?? [];
  const localById = new Map(locals.map((l) => [l.id, l]));
  const serverById = new Map(submissions.map((s) => [s.id, s]));
  const queued = (l: LocalForm | null) => l !== null && l.state === 'queued';

  const todo: MyFormLists['todo'] = [];
  const returned: MyFormLists['returned'] = [];
  const submitted: MyFormLists['submitted'] = [];
  const used = new Set<string>();

  for (const s of submissions) {
    const local = localById.get(s.id) ?? null;
    used.add(s.id);
    if ((s.status === 'submitted' || s.status === 'approved') && !queued(local)) {
      submitted.push({ server: s, local: null });
    } else if (queued(local)) {
      submitted.push({ server: s, local });
    } else if (s.status === 'returned') {
      returned.push({ server: s, local });
    }
  }

  for (const a of assignments) {
    const server = submissions.find((s) => s.assignmentId === a.id) ?? null;
    const local =
      locals.find((l) => l.assignmentId === a.id && !serverById.has(l.id)) ??
      (server ? (localById.get(server.id) ?? null) : null);
    if (server && server.status !== 'draft') continue;
    if (queued(local)) {
      if (!server) submitted.push({ server: null, local });
      if (local) used.add(local.id);
      continue;
    }
    if (local) used.add(local.id);
    todo.push({ key: a.id, title: a.title, dueAt: a.dueAt, assignment: a, server, local });
  }

  // Local forms not tied to anything above (e.g. queued while offline).
  for (const l of locals) {
    if (used.has(l.id) || serverById.has(l.id)) continue;
    if (l.state === 'queued') submitted.push({ server: null, local: l });
    else
      todo.push({
        key: l.id,
        title: l.title,
        dueAt: null,
        assignment: null,
        server: null,
        local: l,
      });
  }

  const due = (d: string | null) => (d ? Date.parse(d) : Number.MAX_SAFE_INTEGER);
  todo.sort((a, b) => due(a.dueAt) - due(b.dueAt));
  return { todo, returned, submitted };
}

/** One of my submissions from the server (RLS: only my own). */
export function useServerSubmission(id: string, enabled: boolean) {
  return useQuery({
    queryKey: formKeys.submission(id),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select(SUBMISSION_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? toSubmission(data as unknown as SubmissionRow) : null;
    },
  });
}

function imageAspect(uri: string): Promise<number> {
  return new Promise((resolve) =>
    Image.getSize(
      uri,
      (w, h) => resolve(w > 0 && h > 0 ? w / h : 8.5 / 11),
      () => resolve(8.5 / 11),
    ),
  );
}

/**
 * A published version, from this phone when cached, else downloaded (fields +
 * page images) and cached. `version: 'current'` asks the server which one is
 * current, falling back to the newest cached one when offline.
 */
export function useFormVersion(
  userId: string,
  templateId: string | null,
  version: number | 'current',
) {
  return useQuery({
    queryKey: formKeys.version(templateId ?? '', version),
    enabled: templateId !== null,
    staleTime: version === 'current' ? 60_000 : Infinity,
    networkMode: 'always',
    queryFn: async (): Promise<CachedVersion> => {
      const id = templateId!;
      if (typeof version === 'number') {
        const cached = await readCachedVersion(userId, id, version);
        if (cached) return cached;
      }

      let wanted = version;
      try {
        if (wanted === 'current') {
          const { data, error } = await supabase
            .from('form_templates')
            .select('version')
            .eq('id', id)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error('This form is no longer available.');
          wanted = data.version;
          const cached = await readCachedVersion(userId, id, wanted);
          if (cached) return cached;
        }
        const { data: v, error } = await supabase
          .from('form_template_versions')
          .select('version, title, description, fields, page_image_paths')
          .eq('template_id', id)
          .eq('version', wanted)
          .maybeSingle();
        if (error) throw error;
        if (!v) throw new Error('This form is no longer available.');

        const { data: signed, error: signError } = await supabase.storage
          .from(FORM_TEMPLATES_BUCKET)
          .createSignedUrls(v.page_image_paths, SIGNED_URL_MAX_SECONDS);
        if (signError || !signed) throw signError ?? new Error('Could not load the pages.');
        const urls = v.page_image_paths.map(
          (p) => signed.find((s) => s.path === p)?.signedUrl ?? '',
        );
        if (urls.some((u) => !u)) throw new Error('Could not load the pages.');

        const fields = (Array.isArray(v.fields) ? v.fields : []) as unknown as VersionField[];
        const cached = await cacheVersion(
          userId,
          {
            templateId: id,
            version: v.version,
            title: v.title,
            description: v.description,
            fields: [...fields].sort((a, b) => a.sort_order - b.sort_order),
          },
          urls,
          imageAspect,
        );
        return cached;
      } catch (e) {
        // Offline: the newest version kept on this phone.
        const fallback =
          typeof version === 'number'
            ? await readCachedVersion(userId, id, version)
            : await latestCachedVersion(userId, id);
        if (fallback) return fallback;
        throw e;
      }
    },
  });
}

/**
 * Downloads my filled PDF (short-lived signed URL; RLS: my own folder) into
 * the cache and opens it in the phone's PDF viewer.
 */
export async function openFilledPdf(submissionId: string, title: string): Promise<void> {
  const { data, error } = await supabase
    .from('form_submissions')
    .select('filled_pdf_path')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.filled_pdf_path) throw new Error('The PDF is not ready yet.');
  const { data: signed, error: signError } = await supabase.storage
    .from(FORM_SUBMISSIONS_BUCKET)
    .createSignedUrl(data.filled_pdf_path, 60);
  if (signError || !signed) throw signError ?? new Error('Could not open the PDF.');

  const dir = new Directory(Paths.cache, 'form-pdfs');
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `${submissionId}.pdf`);
  await File.downloadFileAsync(signed.signedUrl, file, { idempotent: true });
  await File.preview(file, { title, mimeType: 'application/pdf' });
}

/** Required fields still empty (checkbox: not ticked; signature: none). */
export function missingRequired(
  fields: VersionField[],
  values: Record<string, unknown>,
  hasSignature: boolean,
): VersionField[] {
  return fields.filter((f) => {
    if (!f.required) return false;
    if (f.type === 'signature') return !hasSignature;
    const v = values[f.key];
    if (f.type === 'checkbox') return v !== true;
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
}
