'use server';

import { recordIdSchema, siteCreateSchema, siteDetailsSchema } from '@deltaguard/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin, requireStaff } from '@/lib/auth';
import { checked, FOREIGN_KEY_VIOLATION, json, num, text } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Sites: admins create, delete and move sites between clients; admins and
// supervisors edit a site's details (RLS + a guard trigger enforce the same).

/** Drop blank optional fields from contacts edited in the browser. */
function cleanContacts(value: unknown): unknown {
  if (!Array.isArray(value)) return value ?? [];
  return value.map((c: unknown) =>
    c && typeof c === 'object'
      ? Object.fromEntries(
          Object.entries(c).flatMap(([k, v]) => {
            const s = typeof v === 'string' ? v.trim() : v;
            return s === '' || s === undefined ? [] : [[k, s]];
          }),
        )
      : c,
  );
}

function siteFields(fd: FormData) {
  return {
    name: text(fd, 'name') ?? '',
    address: text(fd, 'address'),
    latitude: num(fd, 'latitude'),
    longitude: num(fd, 'longitude'),
    clock_in_radius_m: num(fd, 'clock_in_radius_m') ?? undefined,
    emergency_instructions: text(fd, 'emergency_instructions'),
    site_contacts: cleanContacts(json(fd, 'site_contacts')),
    active: checked(fd, 'active'),
  };
}

export async function createSite(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = siteCreateSchema.safeParse({
    client_id: text(fd, 'client_id'),
    ...siteFields(fd),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from('sites').insert(parsed.data).select('id').single();
  if (error) return { ok: false, message: error.message };

  redirect(`/sites/${data.id}`);
}

export async function updateSite(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);
  const parsed = siteDetailsSchema.safeParse(siteFields(fd));
  if (!parsed.success) return invalid(parsed.error);

  // Only admins may move a site to another client.
  let clientId: string | undefined;
  if (staff.role === 'admin' && fd.has('client_id')) {
    const client = recordIdSchema.safeParse({ id: text(fd, 'client_id') });
    if (!client.success) {
      return {
        ok: false,
        message: 'Choose a client.',
        fieldErrors: { client_id: 'Choose a client' },
      };
    }
    clientId = client.data.id;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sites')
    .update({ ...parsed.data, ...(clientId ? { client_id: clientId } : {}) })
    .eq('id', id.data.id)
    .select('id');
  if (error) return { ok: false, message: error.message };
  if (!data.length) return { ok: false, message: 'Site not found.' };

  refresh();
  return { ok: true, message: 'Site saved.' };
}

export async function deleteSite(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!id.success) return invalid(id.error);

  const supabase = await createClient();
  const { error } = await supabase.from('sites').delete().eq('id', id.data.id);
  if (error) {
    return {
      ok: false,
      message:
        error.code === FOREIGN_KEY_VIOLATION
          ? 'This site has shifts on record, so it can’t be deleted. Untick “Active” instead.'
          : error.message,
    };
  }

  redirect('/sites');
}
