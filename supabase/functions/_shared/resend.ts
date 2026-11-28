// Email transport for every Edge Function that sends email (Resend API).
// To switch provider, replace this file only.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY  API key from resend.com (Sending access is enough)
//   EMAIL_FROM      e.g. "DeltaGuard <no-reply@mail.deltaconsecurity.com>".
//                   The domain must be verified in Resend. Until it is, Resend
//                   only delivers to the email of the Resend account owner.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('EMAIL_FROM');

export type EmailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Same key within 24 h = Resend sends once (safe to retry). */
  idempotencyKey?: string;
};

export type SendEmailResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured (RESEND_API_KEY / EMAIL_FROM missing)' };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (message.idempotencyKey) headers['Idempotency-Key'] = message.idempotencyKey.slice(0, 256);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = typeof body?.message === 'string' ? body.message : res.statusText;
      return { ok: false, error: `Resend ${res.status}: ${reason}` };
    }
    return { ok: true, id: typeof body?.id === 'string' ? body.id : null };
  } catch (err) {
    return {
      ok: false,
      error: `Resend request failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}
