// welfare-escalation: moves overdue welfare checks through their steps and
// places the automated voice calls and SMS they need.
//
// Called every minute: pg_cron runs public.welfare_run_escalation() in the
// database (so prompts and supervisor pushes never depend on this function)
// and, when calls or SMS are queued, asks this function via pg_net to send
// them. It also runs the escalation step itself first, which is harmless:
// the database moves each check one step at most, under row locks, and every
// call / SMS row is unique, so nothing is ever sent twice.
//
// Deployed with verify_jwt = false (see supabase/config.toml): only the
// database may call it, with the shared secret header (_shared/cron-auth.ts).
//
// POST { "action": "deliver" }   (from pg_net; any body works)
//
// Secrets: see _shared/twilio.ts (calls need TWILIO_VOICE_FROM_NUMBER or
// TWILIO_FROM_NUMBER). Without them, rows are marked "skipped" and logged on
// the check.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { isCronRequest, unauthorized } from '../_shared/cron-auth.ts';
import { placeVoiceCall, type SendResult, sendSms } from '../_shared/twilio.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type OutboxRow = {
  id: string;
  check_id: string;
  kind: 'call' | 'sms';
  attempt_no: number;
  phone: string;
  body: string;
};

function send(row: OutboxRow): Promise<SendResult> {
  return row.kind === 'call' ? placeVoiceCall(row.phone, row.body) : sendSms(row.phone, row.body);
}

async function deliver(): Promise<Record<SendResult['status'], number>> {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc('claim_welfare_outbox', { p_limit: 50 });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as OutboxRow[];
    if (rows.length === 0) break;

    await Promise.all(
      rows.map(async (row) => {
        const result = await send(row);
        counts[result.status]++;
        const { error: finishError } = await db.rpc('finish_welfare_outbox', {
          p_id: row.id,
          p_status: result.status,
          p_provider_id: result.status === 'sent' ? result.providerId : null,
          p_error: result.status === 'sent' ? null : result.error,
        });
        if (finishError) console.error('finish_welfare_outbox', row.id, finishError.message);
      }),
    );
  }
  return counts;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405 });
  }
  if (!isCronRequest(request)) return unauthorized();
  try {
    const { data: moved, error } = await db.rpc('welfare_run_escalation', {
      p_request_delivery: false,
    });
    if (error) console.error('welfare_run_escalation', error.message);
    const delivered = await deliver();
    return new Response(JSON.stringify({ moved: moved ?? 0, ...delivered }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'Welfare escalation failed' }), { status: 500 });
  }
});
