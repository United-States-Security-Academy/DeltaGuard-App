'use server';

import { clientSchema, recordIdSchema } from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { FOREIGN_KEY_VIOLATION, text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Clients: admins write, supervisors read (RLS enforces the same).

function readClient(fd: FormData) {
  return clientSchema.safeParse({
    name: text(fd, 'name') ?? '',
    contact_person: text(fd, 'contact_person'),
    phone: text(fd, 'phone'),
    email: text(fd, 'email'),
    notes: text(fd, 'notes'),
  });
}

export async function addClient(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = readClient(fd);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from('clients').insert(parsed.data).select('id').single();
  if (error) return { ok: false, message: error.message };

  redirect(`/clients/${data.id}`);
}

export async function updateClient(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const parsed = readClient(fd);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .update(parsed.data)
    .eq('id', id.data.id)
    .select('id');
  if (error) return { ok: false, message: error.message };
  if (!data.length) return { ok: false, message: 'Client not found.' };

  refresh();
  return { ok: true, message: 'Client saved.' };
}

export async function deleteClient(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);

  const supabase = await createClient();
  const { error } = await supabase.from('clients').delete().eq('id', id.data.id);
  if (error) {
    return {
      ok: false,
      message:
        error.code === FOREIGN_KEY_VIOLATION
          ? 'This client still has sites. Delete or deactivate them first.'
          : error.message,
    };
  }
  redirect('/clients');
}
