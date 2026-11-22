import 'server-only';

import type { Database } from '@deltaguard/shared';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { supabaseEnv } from './env';

// The service role key bypasses Row Level Security. `server-only` makes the
// build fail if a Client Component ever imports this file, and the key has no
// NEXT_PUBLIC_ prefix, so Next.js never puts it in the browser bundle. This
// schema lives here (not in packages/shared) so nothing about it reaches clients.
// Checked when first used, not at import, so `next build` (and CI) don't
// need the secret.
const serviceRoleKeySchema = z
  .string({ error: 'SUPABASE_SERVICE_ROLE_KEY is missing. Check apps/admin/.env.local.' })
  .min(1)
  .refine((key) => !key.startsWith('sb_publishable_'), {
    message:
      'SUPABASE_SERVICE_ROLE_KEY must be the secret/service_role key, not the publishable key.',
  });

/**
 * Service-role client. Use only for what RLS cannot do (Auth admin APIs:
 * invites, bans, listing emails). Call `requireAdmin()` before using it.
 */
export function createAdminClient() {
  const serviceRoleKey = serviceRoleKeySchema.parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient<Database>(supabaseEnv.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
