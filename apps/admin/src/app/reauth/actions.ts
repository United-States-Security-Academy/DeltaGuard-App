'use server';

import { totpCodeSchema } from '@deltaguard/shared';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/lib/action-state';
import { requireStaff } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

/**
 * Re-authentication for sensitive actions: a fresh TOTP code updates the
 * session's MFA time (amr), then the user goes back to what they were doing.
 */
export async function reauthenticate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const next = safeNext(fd.get('next'));
  const code = totpCodeSchema.safeParse(fd.get('code'));
  if (!code.success) return { ok: false, message: code.error.issues[0]!.message };

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === 'verified');
  if (!factor) return { ok: false, message: 'Two-factor authentication isn’t set up.' };
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: code.data,
  });
  if (error) return { ok: false, message: 'That code did not work. Try the next one.' };
  redirect(next);
}
