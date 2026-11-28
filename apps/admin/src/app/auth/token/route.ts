import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

/**
 * GET /auth/token: the signed-in staff member's short-lived access token, for
 * the browser's Supabase client (lib/supabase/client.ts). The refresh token
 * stays in the httpOnly cookie. Same-origin only: no CORS headers, and
 * browsers' Sec-Fetch-Site must say same-origin when they send it.
 */
export async function GET(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403, headers: NO_STORE });
  }
  if (!(await getStaffSession())) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 401, headers: NO_STORE });
  }
  const supabase = await createClient();
  // The proxy has just verified and, if needed, refreshed this session.
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token || !session.expires_at) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 401, headers: NO_STORE });
  }
  return NextResponse.json(
    { access_token: session.access_token, expires_at: session.expires_at },
    { headers: NO_STORE },
  );
}
