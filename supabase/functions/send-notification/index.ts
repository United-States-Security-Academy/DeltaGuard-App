// send-notification: delivers DeltaGuard notifications through the Expo Push
// API. Deployed with verify_jwt = false (see supabase/config.toml); each mode
// below does its own access check.
//
// POST body, one of:
//
//   { "notification_ids": ["…"] }
//     Push these inbox rows (sent by the database right after it creates
//     them). Only rows still `pending` are pushed. Database only: needs the
//     shared secret header (_shared/cron-auth.ts).
//
//   { "action": "maintenance" }
//     Every 5 minutes (pg_cron): retry pending pushes from the last 24 hours,
//     then read Expo receipts for tickets older than 15 minutes. Database
//     only (shared secret).
//
//   { "user_ids": ["…"], "type": "…", "title": "…", "body": "…",
//     "data": { … }, "dedupe_key": "…" }
//     Create the inbox rows (notify_users) and push them. Only for the
//     service role key or a signed-in admin/supervisor.
//
// Invalid tokens: a ticket or receipt saying DeviceNotRegistered (the app was
// uninstalled, or the token was replaced) clears that device's push_token.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4.6.7';

import { isCronRequest, unauthorized } from '../_shared/cron-auth.ts';

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
const MAX_ATTEMPTS = 5;
/** Pushes that must get through Do Not Disturb (Android channel "sos"). */
const URGENT_TYPES = new Set(['sos', 'welfare_alarm', 'welfare_escalated']);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Optional: required only if "Enhanced push security" is on in the Expo project.
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  push_attempts: number;
};

type Device = { id: string; user_id: string; push_token: string };

type Ticket =
  { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function expoHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
    ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
  };
}

async function clearTokens(client: SupabaseClient, deviceIds: string[]) {
  if (deviceIds.length === 0) return;
  await client.from('user_devices').update({ push_token: null }).in('id', deviceIds);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function deliver(notifications: Notification[]) {
  if (notifications.length === 0) return { sent: 0, noDevice: 0, failed: 0, retry: 0 };

  const userIds = [...new Set(notifications.map((n) => n.user_id))];
  const { data: devices, error } = await db
    .from('user_devices')
    .select('id, user_id, push_token')
    .in('user_id', userIds)
    .is('revoked_at', null)
    .not('push_token', 'is', null);
  if (error) throw new Error(`devices: ${error.message}`);
  const byUser = new Map<string, Device[]>();
  for (const d of (devices ?? []) as Device[]) {
    byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d]);
  }

  // One message per (notification, device).
  const messages: { notification: Notification; device: Device }[] = [];
  const noDevice: string[] = [];
  for (const n of notifications) {
    const targets = byUser.get(n.user_id) ?? [];
    if (targets.length === 0) noDevice.push(n.id);
    for (const device of targets) messages.push({ notification: n, device });
  }
  if (noDevice.length > 0) {
    await db.from('notifications').update({ push_status: 'no_device' }).in('id', noDevice);
  }

  const outcome = new Map<string, { ok: boolean; error?: string; retry?: boolean }>();
  const deadDevices: string[] = [];
  const tickets: { id: string; notification_id: string; device_id: string }[] = [];

  for (const batch of chunk(messages, 100)) {
    let response: Response;
    try {
      response = await fetch(EXPO_SEND, {
        method: 'POST',
        headers: expoHeaders(),
        body: JSON.stringify(
          batch.map(({ notification: n, device }) => ({
            to: device.push_token,
            title: n.title,
            body: n.body,
            data: { ...n.data, type: n.type, notification_id: n.id },
            sound: 'default',
            priority: 'high',
            // SOS alerts, welfare alarms and escalations use their own Android
            // channel (max importance, set up by the app) and iOS
            // "time-sensitive" delivery; a welfare check prompt is time-sensitive.
            channelId: URGENT_TYPES.has(n.type) ? 'sos' : 'default',
            ...(URGENT_TYPES.has(n.type) || n.type === 'welfare_check'
              ? { interruptionLevel: 'time-sensitive' }
              : {}),
          })),
        ),
      });
    } catch (e) {
      for (const { notification } of batch) {
        outcome.set(notification.id, { ok: false, retry: true, error: String(e) });
      }
      continue;
    }

    if (!response.ok) {
      // 429 / 5xx: Expo is busy, try again later. Other codes: our request is wrong.
      const retry = response.status === 429 || response.status >= 500;
      const text = await response.text();
      for (const { notification } of batch) {
        outcome.set(notification.id, {
          ok: false,
          retry,
          error: `Expo ${response.status}: ${text.slice(0, 200)}`,
        });
      }
      continue;
    }

    const { data } = (await response.json()) as { data: Ticket[] };
    batch.forEach(({ notification, device }, i) => {
      const ticket = data[i];
      const previous = outcome.get(notification.id);
      if (ticket?.status === 'ok') {
        tickets.push({ id: ticket.id, notification_id: notification.id, device_id: device.id });
        outcome.set(notification.id, { ok: true });
        return;
      }
      if (ticket?.details?.error === 'DeviceNotRegistered') deadDevices.push(device.id);
      // Sent to at least one of the user's phones counts as sent.
      if (!previous?.ok) {
        outcome.set(notification.id, {
          ok: false,
          retry: ticket?.details?.error === 'MessageRateExceeded',
          error: ticket ? `${ticket.details?.error ?? 'error'}: ${ticket.message}` : 'No ticket',
        });
      }
    });
  }

  await clearTokens(db, deadDevices);
  if (tickets.length > 0) await db.from('push_tickets').upsert(tickets, { ignoreDuplicates: true });

  let sent = 0;
  let failed = 0;
  let retry = 0;
  const now = new Date().toISOString();
  for (const n of notifications) {
    const o = outcome.get(n.id);
    if (!o) continue; // no device
    if (o.ok) {
      sent++;
      await db
        .from('notifications')
        .update({
          push_status: 'sent',
          pushed_at: now,
          push_error: null,
          push_attempts: n.push_attempts + 1,
        })
        .eq('id', n.id);
    } else {
      const attempts = n.push_attempts + 1;
      const keepTrying = o.retry && attempts < MAX_ATTEMPTS;
      if (keepTrying) retry++;
      else failed++;
      await db
        .from('notifications')
        .update({
          push_status: keepTrying ? 'pending' : 'failed',
          push_error: o.error ?? null,
          push_attempts: attempts,
        })
        .eq('id', n.id);
    }
  }
  return { sent, noDevice: noDevice.length, failed, retry };
}

/**
 * Claims pending rows (these ids, or everything pending from the last day).
 * A row is claimed by one delivery only, so it is never pushed twice.
 */
async function pending(ids?: string[]): Promise<Notification[]> {
  if (ids && ids.length === 0) return [];
  const { data, error } = await db.rpc('claim_notifications', { p_ids: ids ?? null });
  if (error) throw new Error(`claim: ${error.message}`);
  return (data ?? []) as Notification[];
}

// ---------------------------------------------------------------------------
// Receipts (some errors, like DeviceNotRegistered, only show up here)
// ---------------------------------------------------------------------------

async function checkReceipts() {
  const { data: rows, error } = await db
    .from('push_tickets')
    .select('id, device_id')
    .is('checked_at', null)
    .lte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1000);
  if (error) throw new Error(`push_tickets: ${error.message}`);
  if (!rows || rows.length === 0) return { checked: 0, removedTokens: 0 };

  const deviceByTicket = new Map(rows.map((r) => [r.id as string, r.device_id as string | null]));
  const dead: string[] = [];
  let checked = 0;

  for (const batch of chunk(
    rows.map((r) => r.id as string),
    1000,
  )) {
    const response = await fetch(EXPO_RECEIPTS, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify({ ids: batch }),
    });
    if (!response.ok) continue; // try again on the next run
    const { data } = (await response.json()) as {
      data: Record<
        string,
        { status: 'ok' | 'error'; message?: string; details?: { error?: string } }
      >;
    };
    const now = new Date().toISOString();
    for (const id of batch) {
      const receipt = data[id];
      // Receipts are kept by Expo for 24 h; none yet means not processed yet.
      if (!receipt) continue;
      checked++;
      if (receipt.details?.error === 'DeviceNotRegistered') {
        const device = deviceByTicket.get(id);
        if (device) dead.push(device);
      }
      await db
        .from('push_tickets')
        .update({
          checked_at: now,
          receipt_status: receipt.status,
          receipt_error:
            receipt.status === 'error' ? (receipt.details?.error ?? receipt.message ?? null) : null,
        })
        .eq('id', id);
    }
  }

  // Tickets older than a day will never get a receipt.
  await db
    .from('push_tickets')
    .update({ checked_at: new Date().toISOString(), receipt_status: 'expired' })
    .is('checked_at', null)
    .lte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString());

  await clearTokens(db, dead);
  return { checked, removedTokens: dead.length };
}

// ---------------------------------------------------------------------------
// Direct sends need the service role or a signed-in admin/supervisor
// ---------------------------------------------------------------------------

async function mayCreate(request: Request): Promise<boolean> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (token === SERVICE_ROLE_KEY) return true;
  const { data, error } = await db.auth.getClaims(token);
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (
    error ||
    claims?.employment_status !== 'active' ||
    (claims?.user_role !== 'admin' && claims?.user_role !== 'supervisor') ||
    typeof claims.sub !== 'string'
  ) {
    return false;
  }
  // The token can be up to an hour old: the live profile must still say active
  // with the same role (a suspended or demoted user is refused at once).
  const { data: profile } = await db
    .from('profiles')
    .select('role, employment_status')
    .eq('id', claims.sub)
    .maybeSingle();
  return profile?.employment_status === 'active' && profile.role === claims.user_role;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = z.string().regex(UUID);

const deliverSchema = z.object({ notification_ids: z.array(uuid).min(1).max(500) });
const maintenanceSchema = z.object({ action: z.literal('maintenance') });
const sendSchema = z.object({
  user_ids: z.array(uuid).min(1).max(500),
  type: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(1000),
  data: z.record(z.string(), z.unknown()).optional(),
  dedupe_key: z.string().max(200).nullish(),
});

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  try {
    const delivery = deliverSchema.safeParse(body);
    if (delivery.success) {
      if (!isCronRequest(request)) return unauthorized();
      return json(await deliver(await pending(delivery.data.notification_ids)));
    }

    if (maintenanceSchema.safeParse(body).success) {
      if (!isCronRequest(request)) return unauthorized();
      const delivered = await deliver(await pending());
      const receipts = await checkReceipts();
      return json({ delivered, receipts });
    }

    const send = sendSchema.safeParse(body);
    if (send.success) {
      if (!(await mayCreate(request))) return json({ error: 'Not allowed' }, 403);
      const input = send.data;
      // Creating the rows also asks for delivery (pg_net -> this function);
      // deliver now too, so the caller gets the result.
      const { error } = await db.rpc('notify_users', {
        p_user_ids: input.user_ids,
        p_type: input.type,
        p_title: input.title,
        p_body: input.body,
        p_data: input.data ?? {},
        p_dedupe_key: input.dedupe_key ?? null,
      });
      if (error) {
        console.error('notify_users', error.message);
        return json({ error: 'Could not create the notifications' }, 400);
      }
      const { data: rows } = await db
        .from('notifications')
        .select('id')
        .in('user_id', input.user_ids)
        .eq('type', input.type)
        .eq('push_status', 'pending')
        .gte('created_at', new Date(Date.now() - 60_000).toISOString());
      return json(await deliver(await pending((rows ?? []).map((r) => r.id as string))));
    }

    return json({ error: 'Unknown request' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Delivery failed' }, 500);
  }
});
