import { LICENSES_BUCKET, recordIdSchema } from '@deltaguard/shared';
import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** How long the signed link to the private file works. Opened immediately, so short. */
const SIGNED_URL_SECONDS = 60;

/**
 * GET /scans/<qualification id>: opens that qualification's licence scan.
 * Looks the file up by qualification (never by a path from the URL) as the
 * signed-in staff member, so RLS decides access, then redirects to a
 * short-lived signed URL for the private bucket.
 */
export async function GET(_request: Request, { params }: RouteContext<'/scans/[id]'>) {
  if (!(await getStaffSession())) {
    return new NextResponse('Not allowed', { status: 403 });
  }

  const id = recordIdSchema.safeParse(await params);
  if (!id.success) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase
    .from('qualifications')
    .select('document_path')
    .eq('id', id.data.id)
    .maybeSingle();
  if (!data?.document_path) return new NextResponse('Not found', { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from(LICENSES_BUCKET)
    .createSignedUrl(data.document_path, SIGNED_URL_SECONDS);
  if (error || !signed) return new NextResponse('Could not open the file', { status: 502 });

  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
