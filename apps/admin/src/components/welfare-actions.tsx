'use client';

import {
  acknowledgeWelfareCheckSchema,
  resolveWelfareCheckSchema,
  WELFARE_RESOLUTION_EXAMPLES,
  type WelfareCheckStatus,
} from '@deltaguard/shared';
import { useState } from 'react';

import { consoleError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';

import { Button } from './ui';

/**
 * Call the officer, acknowledge (escalated only; notes optional) and resolve
 * (notes required), with the staff member's own session. The database checks
 * who may act and logs everything on the check.
 */
export function WelfareActions({
  checkId,
  status,
  acknowledged,
  officerPhone,
  onDone,
  tone = 'default',
}: {
  checkId: string;
  status: WelfareCheckStatus;
  acknowledged: boolean;
  officerPhone: string | null;
  onDone?: () => void;
  /** 'alarm': on the full-screen overlay. */
  tone?: 'default' | 'alarm';
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'ack' | 'resolve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvable = ['prompted', 'alarm', 'calling', 'escalated'].includes(status);
  if (!resolvable) return null;
  const canAck = status === 'escalated' && !acknowledged;

  async function acknowledge() {
    const parsed = acknowledgeWelfareCheckSchema.safeParse({
      p_check_id: checkId,
      p_notes: notes.trim() || undefined,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the note');
    setBusy('ack');
    const { error } = await createClient().rpc('acknowledge_welfare_check', parsed.data);
    setBusy(null);
    if (error) return setError(consoleError(error, 'acknowledge the alert'));
    setError(null);
    setNotes('');
    onDone?.();
  }

  async function resolve() {
    const parsed = resolveWelfareCheckSchema.safeParse({ p_check_id: checkId, p_notes: notes });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Add a note');
    setBusy('resolve');
    const { error } = await createClient().rpc('resolve_welfare_check', parsed.data);
    setBusy(null);
    if (error) return setError(consoleError(error, 'resolve the check'));
    setError(null);
    setNotes('');
    onDone?.();
  }

  const alarm = tone === 'alarm';
  const outline = alarm ? 'border-white/40 bg-transparent text-white hover:bg-white/10' : '';
  return (
    <div className="flex flex-col gap-3">
      {officerPhone ? (
        <a
          href={`tel:${officerPhone}`}
          className={`inline-flex w-fit items-center gap-2 rounded-full px-6 py-3 text-base font-bold shadow-sm ${
            alarm
              ? 'bg-white text-amber-800 hover:bg-amber-50'
              : 'bg-ink text-white hover:bg-navy dark:bg-gold dark:text-ink'
          }`}
        >
          Call officer · {officerPhone}
        </a>
      ) : (
        <p className={`text-sm ${alarm ? 'text-white/80' : 'text-muted'}`}>
          No phone number on the officer’s profile.
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={`font-medium ${alarm ? 'text-white' : ''}`}>
          Notes{' '}
          {canAck ? '(optional to acknowledge, required to resolve)' : '(required to resolve)'}
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder={canAck ? 'e.g. Calling the officer now' : 'What happened and what was done'}
          className={`rounded-xl border px-3 py-2 outline-none focus:ring-2 ${
            alarm
              ? 'border-white/30 bg-white/10 text-white placeholder:text-white/60 focus:ring-white/60'
              : 'border-line bg-surface focus:border-gold focus:ring-gold/30'
          }`}
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {WELFARE_RESOLUTION_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setNotes(example)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              alarm ? 'bg-white/15 hover:bg-white/25' : 'bg-surface-2 text-muted hover:text-fg'
            }`}
          >
            {example}
          </button>
        ))}
      </div>
      {error ? (
        <p
          role="alert"
          className={`text-sm ${alarm ? 'font-medium text-white' : 'text-red-600 dark:text-red-400'}`}
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canAck ? (
          <button
            type="button"
            onClick={() => void acknowledge()}
            disabled={busy !== null}
            className={`rounded-full px-6 py-3 text-base font-bold shadow-sm disabled:opacity-60 ${
              alarm
                ? 'bg-white text-amber-800 hover:bg-amber-50'
                : 'bg-red-600 text-white hover:bg-red-500'
            }`}
          >
            {busy === 'ack' ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => void resolve()}
          disabled={busy !== null}
          className={outline}
        >
          {busy === 'resolve' ? 'Resolving…' : 'Resolve'}
        </Button>
      </div>
    </div>
  );
}
