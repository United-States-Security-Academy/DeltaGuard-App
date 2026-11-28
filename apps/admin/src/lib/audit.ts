import 'server-only';

import type { Json } from '@deltaguard/shared';
import { NextResponse } from 'next/server';

import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Actions server code records in the audit log (the database rejects any other). */
export type AuditAction = 'payroll_export' | 'bulk_download' | 'report_export' | 'user_invited';

/**
 * Before an export or bulk download: the database's per-user rate limit
 * (60 an hour). Returns a response to send instead, or null to go ahead.
 */
export async function exportBlocked(supabase: Supabase): Promise<NextResponse | null> {
  const { error } = await supabase.rpc('enforce_rate_limit', { p_action: 'export' });
  if (!error) return null;
  if (error.code === 'DG429') {
    return new NextResponse('Too many downloads. Wait a few minutes and try again.', {
      status: 429,
      headers: { 'Retry-After': '600' },
    });
  }
  console.error('enforce_rate_limit(export):', error.message);
  return new NextResponse('Not allowed', { status: 403 });
}

/**
 * Records an action in the append-only audit log, as the signed-in staff
 * member. Returns false if it couldn't be recorded: callers refuse to hand out
 * the export in that case (no unaudited payroll exports).
 */
export async function recordAudit(
  supabase: Supabase,
  action: AuditAction,
  target: { type: string; id: string },
  details: { [key: string]: Json | undefined } = {},
): Promise<boolean> {
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: action,
    p_target_type: target.type,
    p_target_id: target.id,
    p_details: details,
  });
  if (error) console.error(`log_audit_event(${action}):`, error.message);
  return !error;
}

/** The response when the audit entry couldn't be written. */
export function auditFailed(): NextResponse {
  return new NextResponse('Could not record this download. Try again.', { status: 500 });
}
