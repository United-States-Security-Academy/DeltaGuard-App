import { FORM_SUBMISSIONS_BUCKET, recordIdSchema, toZoned } from '@deltaguard/shared';
import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../../../schedule/data';
import { DOWNLOAD_URL_SECONDS, safeFileName } from '../../../data';

/**
 * GET /forms/submissions/<id>/pdf: downloads the filled PDF. Looked up by
 * submission (never by a path from the URL) as the signed-in staff member, so
 * RLS decides; then a redirect to a 60-second signed URL that downloads.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/forms/submissions/[id]/pdf'>,
) {
  if (!(await getStaffSession())) return new NextResponse('Not allowed', { status: 403 });
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase
    .from('form_submissions')
    .select(
      `filled_pdf_path, submitted_at,
       form_templates(title),
       officer:profiles!form_submissions_officer_id_fkey(full_name)`,
    )
    .eq('id', id.data.id)
    .maybeSingle();
  if (!data?.filled_pdf_path) return new NextResponse('Not found', { status: 404 });

  const date = data.submitted_at
    ? toZoned(data.submitted_at, await getTimeZone(supabase)).date
    : '';
  const name = `${safeFileName(data.form_templates?.title ?? 'Form')} - ${safeFileName(data.officer?.full_name ?? 'Officer')}${date ? ` - ${date}` : ''}.pdf`;
  const { data: signed, error } = await supabase.storage
    .from(FORM_SUBMISSIONS_BUCKET)
    .createSignedUrl(data.filled_pdf_path, DOWNLOAD_URL_SECONDS, { download: name });
  if (error || !signed) return new NextResponse('Could not open the file', { status: 502 });

  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
