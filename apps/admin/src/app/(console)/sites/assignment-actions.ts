'use server';

import { siteAssignmentSchema } from '@deltaguard/shared';
import { refresh } from 'next/cache';

import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { text, UNIQUE_VIOLATION } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Used from both the officer page (pick a site) and the site page (pick an
// officer). Only admins assign; RLS enforces the same rule.

export async function assignOfficer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = siteAssignmentSchema.safeParse({
    site_id: text(fd, 'site_id'),
    officer_id: text(fd, 'officer_id'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  // Only active officers can be assigned.
  const { data: officer } = await supabase
    .from('profiles')
    .select('role, employment_status')
    .eq('id', parsed.data.officer_id)
    .maybeSingle();
  if (officer?.role !== 'officer' || officer.employment_status !== 'active') {
    return { ok: false, message: 'Only active officers can be assigned to a site.' };
  }

  const { error } = await supabase.from('site_assignments').insert(parsed.data);
  if (error) {
    return {
      ok: false,
      message: error.code === UNIQUE_VIOLATION ? 'Already assigned to this site.' : error.message,
    };
  }
  refresh();
  return { ok: true, message: 'Assigned.' };
}

export async function unassignOfficer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = siteAssignmentSchema.safeParse({
    site_id: text(fd, 'site_id'),
    officer_id: text(fd, 'officer_id'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from('site_assignments')
    .delete()
    .eq('site_id', parsed.data.site_id)
    .eq('officer_id', parsed.data.officer_id);
  if (error) return { ok: false, message: error.message };

  refresh();
  return { ok: true, message: 'Removed from site.' };
}
