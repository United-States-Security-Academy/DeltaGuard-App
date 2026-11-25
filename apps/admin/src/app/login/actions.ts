'use server';

import { signInSchema } from '@deltaguard/shared';
import { redirect } from 'next/navigation';

import { type ActionState, invalid } from '@/lib/action-state';
import { MFA_REQUIRED } from '@/lib/mfa';
import { createClient } from '@/lib/supabase/server';

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Same message for unknown email and wrong password.
    return { ok: false, message: 'Incorrect email or password.' };
  }

  // Officers and inactive staff are not allowed in the console at all.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const isStaff = claims?.user_role === 'admin' || claims?.user_role === 'supervisor';
  if (!isStaff || claims?.employment_status !== 'active') {
    await supabase.auth.signOut({ scope: 'local' });
    return {
      ok: false,
      message:
        'This account does not have access to the admin console. Officers use the Deltacon Guard mobile app.',
    };
  }

  redirect(MFA_REQUIRED ? '/mfa' : '/');
}
