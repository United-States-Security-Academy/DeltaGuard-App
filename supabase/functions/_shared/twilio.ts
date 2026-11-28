// Twilio transport shared by Edge Functions: SMS and automated voice calls.
//
// Secrets (supabase secrets set ...):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_MESSAGING_SERVICE_SID  SMS from a Messaging Service (preferred), or
//   TWILIO_FROM_NUMBER            E.164 number for SMS, and for calls unless
//   TWILIO_VOICE_FROM_NUMBER      a separate voice-capable number is set.
// A Messaging Service can't place calls: voice needs a Twilio phone number.

export type SendResult =
  | { status: 'sent'; providerId: string | null }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; error: string };

const SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const SERVICE = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
const FROM = Deno.env.get('TWILIO_FROM_NUMBER');
const VOICE_FROM = Deno.env.get('TWILIO_VOICE_FROM_NUMBER') ?? FROM;

async function post(path: string, form: URLSearchParams): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
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

export function sendSms(to: string, body: string): Promise<SendResult> {
  if (!SID || !TOKEN || (!SERVICE && !FROM)) {
    return Promise.resolve({
      status: 'skipped',
      error: 'SMS is not configured (Twilio secrets missing)',
    });
  }
  const form = new URLSearchParams({ To: to, Body: body });
  if (SERVICE) form.set('MessagingServiceSid', SERVICE);
  else form.set('From', FROM!);
  return post('Messages.json', form);
}

function xmlEscape(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Places a call that reads `message` aloud (twice). "sent" = Twilio accepted the call. */
export function placeVoiceCall(to: string, message: string): Promise<SendResult> {
  if (!SID || !TOKEN || !VOICE_FROM) {
    return Promise.resolve({
      status: 'skipped',
      error:
        'Voice calls are not configured (TWILIO_VOICE_FROM_NUMBER or TWILIO_FROM_NUMBER missing)',
    });
  }
  const say = xmlEscape(message);
  const twiml =
    `<Response><Say voice="Polly.Joanna">${say}</Say><Pause length="1"/>` +
    `<Say voice="Polly.Joanna">${say}</Say></Response>`;
  return post(
    'Calls.json',
    new URLSearchParams({ To: to, From: VOICE_FROM, Twiml: twiml, Timeout: '30' }),
  );
}
