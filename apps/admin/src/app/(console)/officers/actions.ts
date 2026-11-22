'use server';

import {
  adminProfileUpdateSchema,
  LICENSES_BUCKET,
  officerDetailsSchema,
  qualificationSchema,
  recordIdSchema,
} from '@deltaguard/shared';
import { refresh } from 'next/cache';

import { type ActionState, invalid } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { text, UNIQUE_VIOLATION } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

// Officer records are admin-only writes (RLS enforces this too). Every action
// re-checks the caller, because server actions are public HTTP endpoints.

export async function saveOfficerDetails(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();

  const userId = text(fd, 'user_id');
  const profile = adminProfileUpdateSchema.safeParse({
    full_name: text(fd, 'full_name') ?? '',
    phone: text(fd, 'phone'),
  });

  const contactName = text(fd, 'ec_name');
  const contactPhone = text(fd, 'ec_phone');
  const contactRelationship = text(fd, 'ec_relationship');
  const anyContact = contactName || contactPhone || contactRelationship;

  const details = officerDetailsSchema.safeParse({
    user_id: userId,
    employee_number: text(fd, 'employee_number'),
    address: text(fd, 'address'),
    date_hired: text(fd, 'date_hired'),
    emergency_contact: anyContact
      ? {
          name: contactName ?? '',
          phone: contactPhone ?? '',
          relationship: contactRelationship ?? undefined,
        }
      : null,
  });

  if (!profile.success) return invalid(profile.error);
  if (!details.success) {
    // Show emergency-contact errors under the right inputs.
    const state = invalid(details.error);
    for (const issue of details.error.issues) {
      if (issue.path[0] === 'emergency_contact' && issue.path[1]) {
        state!.fieldErrors![`ec_${String(issue.path[1])}`] ??= issue.message;
      }
    }
    return state;
  }

  const supabase = await createClient();

  const { error: profileError } = await supabase
    .from('profiles')
    .update(profile.data)
    .eq('id', details.data.user_id);
  if (profileError) return { ok: false, message: profileError.message };

  const { error } = await supabase
    .from('officer_details')
    .upsert(details.data, { onConflict: 'user_id' });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        message: 'Please fix the highlighted fields.',
        fieldErrors: { employee_number: 'Another officer already has this employee number' },
      };
    }
    return { ok: false, message: error.message };
  }

  refresh();
  return { ok: true, message: 'Details saved.' };
}

/**
 * The scan (if any) was already uploaded from the browser straight to the
 * private bucket using the admin's own session (storage RLS: admins only), so
 * large files never pass through this server. Here we only record the row,
 * and remove the uploaded file again if the row can't be saved.
 */
export async function addQualification(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = qualificationSchema.safeParse({
    user_id: text(fd, 'user_id'),
    type: text(fd, 'type') ?? '',
    license_number: text(fd, 'license_number'),
    issued_on: text(fd, 'issued_on'),
    expires_on: text(fd, 'expires_on'),
    document_path: text(fd, 'document_path'),
  });

  const supabase = await createClient();
  const uploaded = text(fd, 'document_path');
  const userId = text(fd, 'user_id');
  // Only ever clean up inside this officer's folder.
  const cleanUp = async () => {
    if (uploaded && userId && uploaded.startsWith(`${userId}/`)) {
      await supabase.storage.from(LICENSES_BUCKET).remove([uploaded]);
    }
  };

  if (!parsed.success) {
    await cleanUp();
    return invalid(parsed.error);
  }

  const { error } = await supabase.from('qualifications').insert(parsed.data);
  if (error) {
    await cleanUp();
    return { ok: false, message: error.message };
  }

  refresh();
  return { ok: true, message: `${parsed.data.type} added.` };
}

export async function deleteQualification(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = recordIdSchema.safeParse({ id: text(fd, 'id') });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('qualifications')
    .delete()
    .eq('id', parsed.data.id)
    .select('document_path');
  if (error) return { ok: false, message: error.message };
  if (!data.length) return { ok: false, message: 'Qualification not found.' };

  // Supabase blocks deleting storage files with SQL, so remove the scan
  // through the Storage API (as the admin; storage RLS allows it).
  const path = data[0]?.document_path;
  if (path) {
    const { error: fileError } = await supabase.storage.from(LICENSES_BUCKET).remove([path]);
    if (fileError) {
      refresh();
      return {
        ok: false,
        message: `Deleted, but the scan could not be removed: ${fileError.message}`,
      };
    }
  }

  refresh();
  return { ok: true, message: 'Qualification deleted.' };
}
