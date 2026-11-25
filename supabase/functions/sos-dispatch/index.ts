// sos-dispatch: sends the SOS text messages queued in public.sos_sms_outbox.
// Deployed with verify_jwt = false (see supabase/config.toml): it only ever
// sends rows the database has already queued, so calling it can't create or
// change an alert; the worst a stranger can do is make it send pending rows
// a little sooner.
//
// Who gets what, and when, is decided in the database (sos_run_dispatch, run at
// once by raise_sos and every 15 s by pg_cron). This function is only the SMS
// transport, with retries (finish_sos_sms backs off 15 s, 30 s, 60 s, 120 s;
// at most 5 attempts).
//
// POST { "action": "send_sms" }   (from pg_net; any body works)
//
// Secrets (supabase secrets set ...):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_MESSAGING_SERVICE_SID  (preferred: a Messaging Service with your
//                                  registered toll-free / 10DLC number), or
//   TWILIO_FROM_NUMBER            (E.164, e.g. +12145550123)
//   ADMIN_CONSOLE_URL             optional, e.g. https://admin.example.com; adds a
//                                 link to the alert in the console
// Without the Twilio secrets, rows are marked "skipped" and logged on the alert,
// so the console shows that no SMS went out.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_CONSOLE_URL = Deno.env.get('ADMIN_CONSOLE_URL')?.replace(/\/+$/, '');

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type OutboxRow = {
  id: string;
  alert_id: string;
  recipient_name: string | null;
  phone: string;
  body: string;
  attempts: number;
};

type SendResult =
  | { status: 'sent'; providerId: string | null }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; error: string };

// ---------------------------------------------------------------------------
// SMS provider. To switch provider, replace this function only.
// ---------------------------------------------------------------------------

const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_SERVICE = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
const TWILIO_FROM = Deno.env.get('TWILIO_FROM_NUMBER');

async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!TWILIO_SID || !TWILIO_TOKEN || (!TWILIO_SERVICE && !TWILIO_FROM)) {
    return { status: 'skipped', error: 'SMS is not configured (Twilio secrets missing)' };
  }
  const form = new URLSearchParams({ To: to, Body: body });
  if (TWILIO_SERVICE) form.set('MessagingServiceSid', TWILIO_SERVICE);
  else form.set('From', TWILIO_FROM!);

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (e) {
    return { status: 'failed', error: `Network error: ${String(e)}` };
  }
  const result = (await response.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
    code?: number;
  };
  if (response.ok) return { status: 'sent', providerId: result.sid ?? null };
  return {
    status: 'failed',
    error: `Twilio ${response.status}${result.code ? ` (${result.code})` : ''}: ${result.message ?? 'error'}`,
  };
}

// ---------------------------------------------------------------------------

function withLink(row: OutboxRow): string {
  return ADMIN_CONSOLE_URL ? `${row.body} Respond: ${ADMIN_CONSOLE_URL}/sos/${row.alert_id}` : row.body;
}

async function sendPending(): Promise<{ sent: number; failed: number; skipped: number }> {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  // Keep claiming until nothing is due (a burst can exceed one batch).
  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc('claim_sos_sms', { p_limit: 50 });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as OutboxRow[];
    if (rows.length === 0) break;

    // Every recipient at once: an SOS shouldn't wait on the slowest send.
    await Promise.all(
      rows.map(async (row) => {
        const result = await sendSms(row.phone, withLink(row));
        counts[result.status]++;
        const { error: finishError } = await db.rpc('finish_sos_sms', {
          p_id: row.id,
          p_status: result.status,
          p_provider_id: result.status === 'sent' ? result.providerId : null,
          p_error: result.status === 'sent' ? null : result.error,
        });
        if (finishError) console.error('finish_sos_sms', row.id, finishError.message);
      }),
    );
  }
  return counts;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405 });
  }
  try {
    const result = await sendPending();
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'SMS dispatch failed' }), { status: 500 });
  }
});
