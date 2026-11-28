'use server';

import { postOrderSchema, recordIdSchema } from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { failed } from '@/lib/server-errors';
import { type ActionState, invalid } from '@/lib/action-state';
import { requireStaff } from '@/lib/auth';
import { text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Post orders: admins and supervisors create, edit (= publish a new version)
// and retire them. Versioning is done by a database trigger; RLS enforces
// the same roles.

function fields(fd: FormData) {
  return { title: text(fd, 'title') ?? '', body: text(fd, 'body') ?? '' };
}

export async function createPostOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const site = recordIdSchema.safeParse({ id: text(fd, 'site_id') });
  if (!site.success) return { ok: false, message: 'Unknown site.' };
  const parsed = postOrderSchema.safeParse(fields(fd));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('post_orders')
    .insert({ site_id: site.data.id, ...parsed.data })
    .select('id')
    .single();
  if (error) return failed(error);

  redirect(`/sites/${site.data.id}/post-orders/${data.id}`);
}

export async function updatePostOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const parsed = postOrderSchema.safeParse(fields(fd));
  if (!parsed.success) return invalid(parsed.error);
  const before = z.coerce.number().int().catch(0).parse(text(fd, 'version'));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('post_orders')
    .update(parsed.data)
    .eq('id', id.data.id)
    .select('version')
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { ok: false, message: 'Post order not found.' };

  refresh();
  if (data.version === before) return { ok: true, message: 'No changes to publish.' };
  return {
    ok: true,
    message: `Published version ${data.version}. Officers at this site must acknowledge it before their next clock-in.`,
  };
}

export async function setPostOrderArchived(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const archive = text(fd, 'archive') === 'true';

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('post_orders')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', id.data.id)
    .select('id');
  if (error) return failed(error);
  if (!data.length) return { ok: false, message: 'Post order not found.' };

  refresh();
  return { ok: true, message: archive ? 'Post order retired.' : 'Post order restored.' };
}
