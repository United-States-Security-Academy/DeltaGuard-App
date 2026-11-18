import type { Database } from '@deltaguard/shared';
import { createBrowserClient } from '@supabase/ssr';

import { supabaseEnv } from './env';

/** Supabase client for Client Components. The session lives in cookies so the server can read it too. */
export function createClient() {
  return createBrowserClient<Database>(supabaseEnv.url, supabaseEnv.anonKey);
}
