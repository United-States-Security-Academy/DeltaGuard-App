'use server';

import { recordIdSchema, sosContactSchema } from '@deltaguard/shared';
import { refresh } from 'next/cache';

import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Escalation contacts: admins write with their own session (RLS: admins only).

export async function addSosContact(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = sosContactSchema.safeParse({
    position: text(fd, 'position') ?? '',
    name: text(fd, 'name') ?? '',
    phone: text(fd, 'phone') ?? '',
    user_id: text(fd, 'user_id'),
    active: true,
  });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from('sos_contacts').insert(parsed.data);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: 'Contact added.' };
}

export async function toggleSosContact(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from('sos_contacts')
    .update({ active: text(fd, 'active') === 'true' })
    .eq('id', id.data.id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: 'Saved.' };
}

export async function deleteSosContact(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const supabase = await createClient();
  const { error } = await supabase.from('sos_contacts').delete().eq('id', id.data.id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: 'Contact removed.' };
}
