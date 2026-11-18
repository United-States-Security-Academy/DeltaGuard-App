import { parseSupabasePublicEnv } from '@deltaguard/shared';

// Referenced with full dot notation so Next.js can inline them into the browser bundle.
export const supabaseEnv = parseSupabasePublicEnv({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
