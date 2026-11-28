'use client';

import { WELFARE_PAUSE_EXAMPLES } from '@deltaguard/shared';
import { useActionState, useId } from 'react';

import { Button, FormMessage } from '@/components/ui';

import { pauseWelfareChecks, resumeWelfareChecks } from './actions';

const LENGTHS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1½ hours' },
  { value: '120', label: '2 hours' },
  { value: '', label: 'Until I resume' },
];

/**
 * Admins: pause welfare checks for one shift (reason required, logged), or
 * resume them. `compact` = the small inline version on the live board.
 */
export function PauseControl({
  shiftId,
  paused,
  compact = false,
}: {
  shiftId: string;
  paused: boolean;
  compact?: boolean;
}) {
  const [pauseState, pauseAction, pausing] = useActionState(pauseWelfareChecks, null);
  const [resumeState, resumeAction, resuming] = useActionState(resumeWelfareChecks, null);
  const listId = useId();

  if (paused) {
    return (
      <form action={resumeAction} className="flex flex-col items-start gap-1">
        <input type="hidden" name="shift_id" value={shiftId} />
        <Button type="submit" variant="secondary" disabled={resuming}>
          {resuming ? 'Resuming…' : 'Resume checks'}
        </Button>
        {resumeState && !resumeState.ok ? <FormMessage state={resumeState} /> : null}
      </form>
    );
  }

  const field =
    'rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30';

  if (compact) {
    return (
      <details className="group">
        <summary className="cursor-pointer list-none text-sm font-medium text-accent-ink hover:underline">
          Pause checks…
        </summary>
        <form action={pauseAction} className="mt-2 flex w-64 flex-col gap-2">
          <input type="hidden" name="shift_id" value={shiftId} />
          <input
            name="reason"
            required
            maxLength={500}
            list={listId}
            placeholder="Reason, e.g. approved break"
            aria-label="Reason"
            className={field}
          />
          <datalist id={listId}>
            {WELFARE_PAUSE_EXAMPLES.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
          <select name="minutes" defaultValue="30" aria-label="For how long" className={field}>
            {LENGTHS.map((l) => (
              <option key={l.label} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={pausing}>
            {pausing ? 'Pausing…' : 'Pause'}
          </Button>
          {pauseState && !pauseState.ok ? <FormMessage state={pauseState} /> : null}
        </form>
      </details>
    );
  }

  return (
    <form action={pauseAction} className="flex flex-col gap-3">
      <input type="hidden" name="shift_id" value={shiftId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Reason</span>
          <input
            name="reason"
            required
            maxLength={500}
            list={listId}
            placeholder="e.g. Approved break"
            className={field}
          />
          <datalist id={listId}>
            {WELFARE_PAUSE_EXAMPLES.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">For</span>
          <select name="minutes" defaultValue="30" className={field}>
            {LENGTHS.map((l) => (
              <option key={l.label} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pausing}>
          {pausing ? 'Pausing…' : 'Pause checks'}
        </Button>
      </div>
      <p className="text-xs text-muted">
        The officer’s pending check is cancelled and they are told checks are paused. An escalated
        check stays open until it is resolved. Logged with your name and the reason.
      </p>
      <FormMessage state={pauseState} />
    </form>
  );
}
