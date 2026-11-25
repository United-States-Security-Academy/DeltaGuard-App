'use client';

import { acknowledgeSosSchema, resolveSosSchema, type SosStatus } from '@deltaguard/shared';
import { useState } from 'react';

import { consoleError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';

import { Button } from './ui';

/**
 * Acknowledge (notes optional) and resolve / false alarm (notes required), with
 * the staff member's own session (the functions check the role and log it all).
 */
export function SosActions({
  alertId,
  status,
  onDone,
  tone = 'default',
}: {
  alertId: string;
  status: SosStatus;
  onDone?: () => void;
  /** 'alarm': on the red full-screen overlay. */
  tone?: 'default' | 'alarm';
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = status === 'active' || status === 'acknowledged';
  if (!open) return null;

  async function acknowledge() {
    const input = acknowledgeSosSchema.parse({ p_alert_id: alertId, p_notes: notes || undefined });
    setBusy('ack');
    const { error } = await createClient().rpc('acknowledge_sos', input);
    setBusy(null);
    if (error) return setError(consoleError(error, 'acknowledge the alert'));
    setError(null);
    setNotes('');
    onDone?.();
  }

  async function resolve(p_status: 'resolved' | 'false_alarm') {
    const parsed = resolveSosSchema.safeParse({ p_alert_id: alertId, p_status, p_notes: notes });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Add a note');
    setBusy(p_status);
    const { error } = await createClient().rpc('resolve_sos', parsed.data);
    setBusy(null);
    if (error) return setError(consoleError(error, 'close the alert'));
    setError(null);
    setNotes('');
    onDone?.();
  }

  const alarm = tone === 'alarm';
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={`font-medium ${alarm ? 'text-white' : ''}`}>
          Notes{' '}
          {status === 'active'
            ? '(optional to acknowledge, required to resolve)'
            : '(required to resolve)'}
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder={
            status === 'active'
              ? 'e.g. Calling the officer now, police dispatched'
              : 'What happened and what was done'
          }
          className={`rounded-xl border px-3 py-2 outline-none focus:ring-2 ${
            alarm
              ? 'border-white/30 bg-white/10 text-white placeholder:text-white/50 focus:ring-white/60'
              : 'border-line bg-surface focus:border-gold focus:ring-gold/30'
          }`}
        />
      </label>
      {error ? (
        <p
          role="alert"
          className={`text-sm ${alarm ? 'text-white' : 'text-red-600 dark:text-red-400'}`}
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === 'active' ? (
          <button
            type="button"
            onClick={() => void acknowledge()}
            disabled={busy !== null}
            className={`rounded-full px-6 py-3 text-base font-bold shadow-sm disabled:opacity-60 ${
              alarm
                ? 'bg-white text-red-700 hover:bg-red-50'
                : 'bg-red-600 text-white hover:bg-red-500'
            }`}
          >
            {busy === 'ack' ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => void resolve('resolved')}
          disabled={busy !== null}
          className={alarm ? 'border-white/40 bg-transparent text-white hover:bg-white/10' : ''}
        >
          {busy === 'resolved' ? 'Resolving…' : 'Resolve'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void resolve('false_alarm')}
          disabled={busy !== null}
          className={alarm ? 'border-white/40 bg-transparent text-white hover:bg-white/10' : ''}
        >
          {busy === 'false_alarm' ? 'Closing…' : 'False alarm'}
        </Button>
      </div>
    </div>
  );
}
