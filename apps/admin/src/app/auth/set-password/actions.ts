'use server';

import { setPasswordSchema } from '@deltaguard/shared';
import { redirect } from 'next/navigation';

import { type ActionState, invalid } from '@/lib/action-state';
import { createClient } from '@/lib/supabase/server';

export async function setPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = setPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login?error=link_invalid');

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: error.message };

  const role = data.claims.user_role;
  if (role === 'admin' || role === 'supervisor') redirect('/mfa');

  // Officers never use the console: sign them out here.
  await supabase.auth.signOut({ scope: 'local' });
  return {
    ok: true,
    message: 'Password set. You can now sign in on the DeltaGuard mobile app.',
  };
}
