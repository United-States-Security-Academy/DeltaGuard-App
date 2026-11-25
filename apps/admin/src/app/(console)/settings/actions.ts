'use server';

import { settingsSchema } from '@deltaguard/shared';
import { refresh } from 'next/cache';

import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { num, text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Company-wide settings (one row). RLS lets only active admins update it, and
// the database re-checks the time zone against Postgres's own list.

export async function updateSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = settingsSchema.safeParse({
    time_zone: text(fd, 'time_zone') ?? '',
    late_grace_minutes: num(fd, 'late_grace_minutes'),
    early_clock_in_minutes: num(fd, 'early_clock_in_minutes'),
    low_accuracy_threshold_m: num(fd, 'low_accuracy_threshold_m'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .update(parsed.data)
    .eq('id', true)
    .select('id');
  if (error) return { ok: false, message: error.message };
  if (!data.length) return { ok: false, message: 'Settings could not be saved.' };

  refresh();
  return { ok: true, message: 'Settings saved.' };
}
