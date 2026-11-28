// send-email: Supabase Auth "Send Email" hook. With the hook enabled, Supabase
// sends NO auth email itself: every invite / recovery / email change /
// reauthentication email comes here and goes out through Resend
// (../_shared/resend.ts) with the Deltacon templates below.
//
// Deployed with verify_jwt = false (see supabase/config.toml): Supabase Auth
// calls it without a user JWT. Every request is checked against the hook's
// Standard Webhooks signature instead, so only Supabase Auth can trigger it.
//
// Links: invites (and recovery) go to the admin console's /auth/accept page,
// never straight to a verify URL, so email link scanners can't use up the
// one-time token (see apps/admin/src/app/auth/accept/page.tsx). Email types the
// app has no screen for use Supabase's own /auth/v1/verify link.
//
// Secrets (supabase secrets set ...):
//   SEND_EMAIL_HOOK_SECRET  the hook secret shown in Dashboard > Authentication >
//                           Hooks (format "v1,whsec_...")
//   ADMIN_CONSOLE_URL       e.g. https://admin.example.com (no trailing slash)
//   RESEND_API_KEY, EMAIL_FROM  see ../_shared/resend.ts
// If sending fails, the hook returns an error and Supabase reports it to the
// caller (the console shows "The invite could not be sent").

import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { z } from 'npm:zod@4.6.7';

import { renderEmail } from '../_shared/email-layout.ts';
import { sendEmail } from '../_shared/resend.ts';

const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace(/^v1,whsec_/, '');
const ADMIN_CONSOLE_URL = Deno.env.get('ADMIN_CONSOLE_URL')?.replace(/\/+$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!.replace(/\/+$/, '');

type HookPayload = {
  user: {
    id: string;
    email: string;
    new_email?: string;
    user_metadata?: { full_name?: unknown };
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new: string;
    token_hash_new: string;
  };
};

/** The Send Email hook's payload (signed by Supabase Auth; still checked). */
const hookPayloadSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    new_email: z.email().optional(),
    user_metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  email_data: z.object({
    token: z.string(),
    token_hash: z.string(),
    redirect_to: z.string(),
    email_action_type: z.string().min(1).max(50),
    site_url: z.string(),
    token_new: z.string(),
    token_hash_new: z.string(),
  }),
});

type Outgoing = { to: string; subject: string; html: string; text: string };

function hookError(status: number, message: string) {
  console.error(`send-email: ${message}`);
  return Response.json({ error: { http_code: status, message } }, { status });
}

function firstName(user: HookPayload['user']): string | null {
  const full = user.user_metadata?.full_name;
  if (typeof full !== 'string') return null;
  const first = full.trim().split(/\s+/)[0];
  return first ? first.slice(0, 60) : null;
}

/** /auth/accept on the console: shows a page first, verifies only on click. */
function acceptLink(tokenHash: string, type: 'invite' | 'recovery'): string | null {
  if (!ADMIN_CONSOLE_URL) return null;
  return `${ADMIN_CONSOLE_URL}/auth/accept?${new URLSearchParams({ token_hash: tokenHash, type })}`;
}

/** Supabase's own verify endpoint, for email types the app has no page for. */
function verifyLink(tokenHash: string, type: string, redirectTo: string): string {
  const params = new URLSearchParams({ token: tokenHash, type });
  if (redirectTo) params.set('redirect_to', redirectTo);
  return `${SUPABASE_URL}/auth/v1/verify?${params}`;
}

function buildEmails(payload: HookPayload): Outgoing[] | string {
  const { user, email_data: d } = payload;
  const hello = firstName(user) ? `Hi ${firstName(user)},` : 'Hello,';

  switch (d.email_action_type) {
    case 'invite': {
      const url = acceptLink(d.token_hash, 'invite');
      if (!url) return 'ADMIN_CONSOLE_URL is not set';
      return [
        {
          to: user.email,
          subject: "You're invited to DeltaGuard",
          ...renderEmail({
            preheader: 'Set your password to start using DeltaGuard.',
            heading: 'Welcome to DeltaGuard',
            paragraphs: [
              hello,
              'Deltacon Security has created a DeltaGuard account for you. Use it to see your shifts, clock in and out, file reports and message your supervisor.',
              'Officers: open this email on your phone with the DeltaGuard app installed, then tap the button and choose "open the app".',
            ],
            button: { label: 'Set your password', url },
            footnote:
              'This link works once and expires. If it has expired, ask your admin to send a new invite.',
          }),
        },
      ];
    }

    case 'recovery': {
      const url = acceptLink(d.token_hash, 'recovery');
      if (!url) return 'ADMIN_CONSOLE_URL is not set';
      return [
        {
          to: user.email,
          subject: 'Reset your DeltaGuard password',
          ...renderEmail({
            preheader: 'Choose a new password for DeltaGuard.',
            heading: 'Reset your password',
            paragraphs: [hello, 'Someone asked to reset the password for your DeltaGuard account.'],
            button: { label: 'Choose a new password', url },
            footnote:
              "If you didn't ask for this, ignore this email: your password stays the same.",
          }),
        },
      ];
    }

    case 'reauthentication':
      return [
        {
          to: user.email,
          subject: 'Your DeltaGuard confirmation code',
          ...renderEmail({
            preheader: `Your code is ${d.token}`,
            heading: 'Confirm it’s you',
            paragraphs: [hello, 'Enter this code to confirm the change to your account:'],
            code: d.token,
            footnote: "If you didn't ask for this, tell your admin.",
          }),
        },
      ];

    case 'email_change': {
      // With "secure email change" on, Supabase sends two hashes. For backward
      // compatibility the names are swapped: token_hash_new confirms from the
      // CURRENT address, token_hash from the NEW one.
      const out: Outgoing[] = [];
      const make = (to: string, hash: string, line: string): Outgoing => ({
        to,
        subject: 'Confirm your new DeltaGuard email',
        ...renderEmail({
          preheader: 'Confirm the change of email address.',
          heading: 'Confirm your email change',
          paragraphs: [hello, line],
          button: {
            label: 'Confirm email change',
            url: verifyLink(hash, 'email_change', d.redirect_to),
          },
          footnote: "If you didn't ask for this, tell your admin at once.",
        }),
      });
      if (d.token_hash_new) {
        out.push(
          make(
            user.email,
            d.token_hash_new,
            `Your account email is changing to ${user.new_email ?? 'a new address'}.`,
          ),
        );
        if (user.new_email && d.token_hash) {
          out.push(
            make(
              user.new_email,
              d.token_hash,
              'Confirm this is your new DeltaGuard email address.',
            ),
          );
        }
      } else {
        out.push(
          make(
            user.new_email ?? user.email,
            d.token_hash,
            'Confirm this is your new DeltaGuard email address.',
          ),
        );
      }
      return out;
    }

    default: {
      // signup / magiclink / email (OTP): not used by this app (public sign-up
      // is off), but never drop an auth email silently.
      return [
        {
          to: user.email,
          subject: 'Your DeltaGuard sign-in link',
          ...renderEmail({
            preheader: 'Your DeltaGuard link.',
            heading: 'Continue to DeltaGuard',
            paragraphs: [hello, 'Use the button below to continue.'],
            button: {
              label: 'Continue',
              url: verifyLink(d.token_hash, d.email_action_type, d.redirect_to),
            },
            code: d.token || undefined,
            footnote: "If you didn't ask for this, ignore this email.",
          }),
        },
      ];
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return hookError(405, 'Method not allowed');
  if (!HOOK_SECRET) return hookError(500, 'SEND_EMAIL_HOOK_SECRET is not set');

  const body = await req.text();
  const headers = Object.fromEntries(req.headers);

  let verified: unknown;
  try {
    verified = new Webhook(HOOK_SECRET).verify(body, headers);
  } catch {
    return hookError(401, 'Invalid webhook signature');
  }
  const parsed = hookPayloadSchema.safeParse(verified);
  if (!parsed.success) return hookError(400, 'Unexpected hook payload');
  const payload = parsed.data as HookPayload;

  const emails = buildEmails(payload);
  if (typeof emails === 'string') {
    console.error(`send-email: ${emails}`);
    return hookError(500, 'Could not prepare the email');
  }

  // webhook-id is the same when Supabase retries, so Resend sends only once.
  const webhookId = req.headers.get('webhook-id') ?? crypto.randomUUID();
  for (const [i, email] of emails.entries()) {
    const result = await sendEmail({ ...email, idempotencyKey: `auth-${webhookId}-${i}` });
    if (!result.ok) {
      // Details stay in the function log; Auth (and whoever called it) gets a plain message.
      console.error(`send-email: Resend failed: ${result.error}`);
      return hookError(502, 'Could not send the email. Try again later');
    }
  }

  return Response.json({});
});
