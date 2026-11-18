import { z } from 'zod';

// Both values are public by design: the anon (or publishable) key only grants
// what Row Level Security policies allow. Never ship the service_role key to a client.
export const supabasePublicEnvSchema = z.object({
  url: z.url({ error: 'Supabase URL is missing or invalid. Check your .env file.' }),
  anonKey: z.string({ error: 'Supabase anon key is missing. Check your .env file.' }).min(1),
});

export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;

export function parseSupabasePublicEnv(env: {
  url: string | undefined;
  anonKey: string | undefined;
}): SupabasePublicEnv {
  return supabasePublicEnvSchema.parse(env);
}
