// verify-upload: checks that an uploaded file really is the JPEG, PNG or PDF
// its name says, with nothing hidden in it (packages/shared/src/file-check.ts:
// PDFs without JavaScript or embedded files), and replaces accepted images
// with the server's own rebuild (image data only). Files that fail are
// deleted and the attempt is audited (finish_upload_check).
//
// Called only by the database, with the shared secret header
// (_shared/cron-auth.ts):
//   { "bucket_id": "…", "name": "…" }   right after an upload (storage trigger)
//   { "action": "sweep" }               every 2 minutes for anything still waiting
//
// Until a file is marked clean, Storage RLS lets only its uploader read it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4.6.7';

import { isCronRequest, unauthorized } from '../_shared/cron-auth.ts';
import { checkFile, sanitizeImage } from '../_shared/image-check.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
/** Larger than any bucket's limit (20 MB): anything bigger is refused. */
const MAX_BYTES = 25 * 1024 * 1024;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const oneSchema = z.object({
  bucket_id: z.string().min(1).max(100),
  name: z.string().min(1).max(1024),
});
const sweepSchema = z.object({ action: z.literal('sweep') });

type Outcome = 'clean' | 'rejected' | 'retry';

async function finish(bucket: string, name: string, status: string, reason: string | null) {
  const { error } = await db.rpc('finish_upload_check', {
    p_bucket: bucket,
    p_name: name,
    p_status: status,
    p_reason: reason,
  });
  if (error) console.error('finish_upload_check', bucket, name, error.message);
}

async function verify(bucket: string, name: string): Promise<Outcome> {
  const { data, error } = await db.storage.from(bucket).download(name);
  if (error || !data) {
    // Not stored yet, or already deleted: the sweep tries again (5 times).
    console.warn('verify-upload: could not download', bucket, name);
    return 'retry';
  }
  if (data.size > MAX_BYTES) {
    await reject(bucket, name, 'file too large');
    return 'rejected';
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const result = await checkFile(name, bytes);
  if (result.ok) {
    // Images are stored as the server's own rebuild: image data only, no
    // metadata. (Uploading with the service role marks the new version clean.)
    if (result.kind !== 'pdf') {
      const clean = sanitizeImage(result.kind, bytes);
      if (clean.length !== bytes.length) {
        const { error: upError } = await db.storage.from(bucket).upload(name, clean, {
          upsert: true,
          contentType: result.kind === 'jpeg' ? 'image/jpeg' : 'image/png',
        });
        if (upError) {
          console.error('verify-upload: could not store the rebuilt image', bucket, name);
          return 'retry';
        }
      }
    }
    await finish(bucket, name, 'clean', null);
    return 'clean';
  }
  await reject(bucket, name, result.reason);
  return 'rejected';
}

async function reject(bucket: string, name: string, reason: string) {
  console.warn('verify-upload: rejected', bucket, name, reason);
  await finish(bucket, name, 'rejected', reason);
  const { error } = await db.storage.from(bucket).remove([name]);
  if (error) console.error('verify-upload: could not delete', bucket, name, error.message);
}

async function sweep() {
  const counts = { clean: 0, rejected: 0, retry: 0 };
  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc('claim_upload_checks', { p_limit: 20 });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { bucket_id: string; name: string }[];
    if (rows.length === 0) break;
    for (const row of rows) counts[await verify(row.bucket_id, row.name)]++;
  }
  return counts;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'Use POST' }, { status: 405 });
  if (!isCronRequest(request)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const one = oneSchema.safeParse(body);
    if (one.success) {
      return Response.json({ result: await verify(one.data.bucket_id, one.data.name) });
    }
    if (sweepSchema.safeParse(body).success) return Response.json(await sweep());
    return Response.json({ error: 'Unknown request' }, { status: 400 });
  } catch (e) {
    console.error('verify-upload', e);
    return Response.json({ error: 'Verification failed' }, { status: 500 });
  }
});
