import { SIGNED_URL_MAX_SECONDS } from '@deltaguard/shared';
import 'server-only';

import type { FormFieldInput } from '@deltaguard/shared';

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Private buckets are only ever reached through signed URLs created here, on
// the server, with the signed-in staff member's session (storage RLS decides).

/** Page images in the editor (the browser loads them at once). */
export const PAGE_IMAGE_URL_SECONDS = SIGNED_URL_MAX_SECONDS;
/** The filled PDF shown inline on the submission page. */
export const VIEW_URL_SECONDS = SIGNED_URL_MAX_SECONDS;
/** "Download": the browser follows the link at once. */
export const DOWNLOAD_URL_SECONDS = 60;

/** Signed URLs in the same order as `paths` (null where signing failed). */
export async function signPaths(
  supabase: Supabase,
  bucket: string,
  paths: string[],
  seconds: number,
): Promise<(string | null)[]> {
  if (paths.length === 0) return [];
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, seconds);
  const byPath = new Map((data ?? []).map((s) => [s.path, s.signedUrl]));
  return paths.map((p) => byPath.get(p) ?? null);
}

const FIELD_COLUMNS =
  'key, label, type, options, required, page, x, y, width, height, font_size, sort_order, acroform_name';

/** A template with its working-copy fields, versions and assignments. RLS applies. */
export async function loadFormTemplate(supabase: Supabase, id: string) {
  const [template, fields, versions, assignments] = await Promise.all([
    supabase.from('form_templates').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('form_fields')
      .select(FIELD_COLUMNS)
      .eq('template_id', id)
      .order('sort_order')
      .order('key'),
    supabase
      .from('form_template_versions')
      .select(
        'version, published_at, fields, publisher:profiles!form_template_versions_published_by_fkey(full_name)',
      )
      .eq('template_id', id)
      .order('version', { ascending: false }),
    supabase
      .from('form_assignments')
      .select(
        `id, officer_id, site_id, role, due_at, created_at, template_version,
         officer:profiles!form_assignments_officer_id_fkey(full_name),
         sites(name)`,
      )
      .eq('template_id', id)
      .order('created_at', { ascending: false }),
  ]);
  if (template.error) throw template.error;
  if (!template.data) return null;
  return {
    template: template.data,
    fields: (fields.data ?? []) as FormFieldInput[],
    versions: versions.data ?? [],
    assignments: assignments.data ?? [],
  };
}

export type LoadedFormTemplate = NonNullable<Awaited<ReturnType<typeof loadFormTemplate>>>;

/** "file name.pdf"-safe text. */
export function safeFileName(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[^\w\s.-]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'form'
  );
}
