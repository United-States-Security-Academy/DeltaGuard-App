'use server';

import { reviewIncidentSchema } from '@deltaguard/shared';
import { refresh } from 'next/cache';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { requireStaff } from '@/lib/auth';
import { text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

const DONE: Record<string, string> = {
  under_review: 'Marked as under review.',
  approved: 'Report approved.',
  returned: 'Report returned to the officer.',
};

/** Admins and supervisors: start reviewing, approve, or return with notes. */
export async function reviewIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = reviewIncidentSchema.safeParse({
    id: text(fd, 'id'),
    status: text(fd, 'status'),
    notes: text(fd, 'notes') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  // As the signed-in reviewer: the function checks role, transition and
  // "not your own report", and the audit log records who did it.
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_incident', {
    p_incident_id: parsed.data.id,
    p_status: parsed.data.status,
    p_notes: parsed.data.notes,
  });
  if (error) return failed(error);

  refresh();
  return { ok: true, message: DONE[parsed.data.status] ?? 'Saved.' };
}
