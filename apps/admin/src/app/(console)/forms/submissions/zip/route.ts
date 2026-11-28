import { FORM_SUBMISSIONS_BUCKET, toZoned } from '@deltaguard/shared';
import { zipSync } from 'fflate';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auditFailed, exportBlocked, recordAudit } from '@/lib/audit';
import { getStaffSession, hasRecentMfa, reauthUrl } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../../schedule/data';
import { DOWNLOAD_URL_SECONDS, safeFileName } from '../../data';

const MAX_FILES = 100;
const idsSchema = z.array(z.uuid()).min(1).max(MAX_FILES);

/**
 * POST /forms/submissions/zip (form field `id`, repeated): the selected
 * submissions' filled PDFs in one ZIP. Rows are read as the signed-in staff
 * member, so RLS decides which ones they may have; each file is fetched
 * through a short-lived signed URL, server-side.
 */
export async function POST(request: Request) {
  const session = await getStaffSession();
  if (!session) return new NextResponse('Not allowed', { status: 403 });

  // Same-site posts only: another site can't make a signed-in browser build ZIPs.
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return new NextResponse('Not allowed', { status: 403 });
  }

  // Bulk download: the authenticator code must have been entered recently.
  if (!hasRecentMfa(session)) {
    return NextResponse.redirect(new URL(reauthUrl('/forms/submissions'), request.url), 303);
  }

  const fd = await request.formData();
  const ids = idsSchema.safeParse([...new Set(fd.getAll('id').map(String))]);
  if (!ids.success) {
    return new NextResponse(`Select between 1 and ${MAX_FILES} submissions.`, { status: 400 });
  }

  const supabase = await createClient();
  const blocked = await exportBlocked(supabase);
  if (blocked) return blocked;
  const { data: rows, error } = await supabase
    .from('form_submissions')
    .select(
      `id, filled_pdf_path, submitted_at, template_version,
       form_templates(title),
       officer:profiles!form_submissions_officer_id_fkey(full_name)`,
    )
    .in('id', ids.data)
    .not('filled_pdf_path', 'is', null);
  if (error) return new NextResponse('Could not load the submissions', { status: 500 });
  if (!rows?.length) return new NextResponse('No PDFs to download', { status: 404 });

  const timeZone = await getTimeZone(supabase);
  const { data: signed } = await supabase.storage.from(FORM_SUBMISSIONS_BUCKET).createSignedUrls(
    rows.map((r) => r.filled_pdf_path!),
    DOWNLOAD_URL_SECONDS,
  );
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const used = new Set<string>();
  for (const r of rows) {
    const url = urlByPath.get(r.filled_pdf_path!);
    if (!url) continue;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) continue;
    const date = r.submitted_at ? toZoned(r.submitted_at, timeZone).date : 'draft';
    let name = `${safeFileName(r.form_templates?.title ?? 'Form')} - ${safeFileName(r.officer?.full_name ?? 'Officer')} - ${date}`;
    if (used.has(name)) name = `${name} - ${r.id.slice(0, 8)}`;
    used.add(name);
    // PDFs are already compressed: store them as they are.
    files[`${name}.pdf`] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
  }
  if (Object.keys(files).length === 0) {
    return new NextResponse('The PDFs could not be fetched', { status: 502 });
  }

  const audited = await recordAudit(
    supabase,
    'bulk_download',
    { type: 'form_submissions', id: `${Object.keys(files).length} files` },
    { submission_ids: rows.map((r) => r.id), files: Object.keys(files).length },
  );
  if (!audited) return auditFailed();

  const zip = zipSync(files);
  const stamp = toZoned(new Date(), timeZone).date;
  return new NextResponse(zip.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="form-submissions-${stamp}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
