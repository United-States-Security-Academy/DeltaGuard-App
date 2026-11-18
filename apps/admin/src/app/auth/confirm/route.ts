import { authLinkParamsSchema } from '@deltaguard/shared';
import { type NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

// Invite (and later password-reset) emails link here with a one-time token
// hash. Verifying it signs the user in, then they choose a password.
// The Supabase email templates must point at this route; see CLAUDE.md.

export async function GET(request: NextRequest) {
  const parsed = authLinkParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const url = request.nextUrl.clone();
  url.search = '';

  if (parsed.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp(parsed.data);
    if (!error) {
      url.pathname = '/auth/set-password';
      return NextResponse.redirect(url);
    }
  }

  url.pathname = '/login';
  url.searchParams.set('error', 'link_invalid');
  return NextResponse.redirect(url);
}
