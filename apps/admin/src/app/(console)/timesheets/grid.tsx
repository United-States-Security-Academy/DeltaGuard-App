'use client';

import { Fragment, useActionState, useState } from 'react';

import { Badge, Button, FormMessage } from '@/components/ui';

import { approveEntries, correctEntry } from './actions';

/** One timesheet line, already formatted on the server (company time zone). */
export type GridRow = {
  id: string;
  date: string;
  officer: string;
  site: string;
  scheduled: string;
  clockIn: string;
  clockOut: string;
  /** Shown struck through when a correction replaced them. */
  originalIn: string | null;
  originalOut: string | null;
  worked: string;
  attention: string[];
  approved: boolean;
  approvedBy: string | null;
  /** Can be ticked for approval. */
  approvable: boolean;
  /** Why it can't be approved yet (shown as a hint). */
  blocked: string | null;
  correctable: boolean;
  defaults: { in_date: string; in_time: string; out_date: string; out_time: string };
  corrections: { id: string; when: string; who: string; change: string; reason: string }[];
};

const HEAD = ['Date', 'Officer', 'Site', 'Scheduled', 'In', 'Out', 'Worked', 'Flags', 'Status', ''];

export function TimesheetGrid({ rows, locked }: { rows: GridRow[]; locked: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [state, approve, approving] = useActionState(approveEntries, null);
  const selectable = rows.filter((r) => r.approvable);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!locked ? (
        <form
          action={(fd) => {
            approve(fd);
            setSelected(new Set());
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="ids" value={JSON.stringify([...selected])} />
          <Button type="submit" disabled={approving || selected.size === 0}>
            {approving ? 'Approving…' : `Approve selected (${selected.size})`}
          </Button>
          <button
            type="button"
            className="text-sm text-slate-500 hover:underline"
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))
            }
          >
            {allSelected ? 'Clear selection' : `Select all approvable (${selectable.length})`}
          </button>
          <FormMessage state={state} />
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
            <tr>
              {!locked ? (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all approvable entries"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))
                    }
                  />
                </th>
              ) : null}
              {HEAD.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr
                  className={`border-t border-slate-200 dark:border-slate-800 ${
                    r.attention.length > 0 ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                  }`}
                >
                  {!locked ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.officer} on ${r.date}`}
                        disabled={!r.approvable}
                        title={r.blocked ?? undefined}
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2">{r.officer}</td>
                  <td className="px-3 py-2">{r.site}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.scheduled}</td>
                  <Time value={r.clockIn} original={r.originalIn} />
                  <Time value={r.clockOut} original={r.originalOut} />
                  <td className="px-3 py-2 font-medium tabular-nums">{r.worked}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.attention.map((a) => (
                        <Badge key={a} tone={a === 'Corrected' ? 'neutral' : 'warn'}>
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.approved ? (
                      <Badge tone="good">Approved</Badge>
                    ) : (
                      <span title={r.blocked ?? undefined}>
                        <Badge tone="neutral">Pending</Badge>
                      </span>
                    )}
                    {r.approvedBy ? (
                      <span className="block text-xs text-slate-500">{r.approvedBy}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.correctable || r.corrections.length > 0 ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-slate-700 hover:underline dark:text-slate-300"
                        onClick={() => setOpen(open === r.id ? null : r.id)}
                        aria-expanded={open === r.id}
                      >
                        {open === r.id ? 'Close' : r.correctable ? 'Correct' : 'History'}
                      </button>
                    ) : null}
                  </td>
                </tr>
                {open === r.id ? (
                  <tr className="bg-slate-50 dark:bg-slate-900/50">
                    <td colSpan={HEAD.length + (locked ? 0 : 1)} className="px-3 py-3">
                      <Detail row={r} onDone={() => setOpen(null)} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Time({ value, original }: { value: string; original: string | null }) {
  return (
    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
      {value}
      {original !== null ? (
        <span className="ml-1 text-xs text-slate-400 line-through" title="Original (from the app)">
          {original}
        </span>
      ) : null}
    </td>
  );
}

function Detail({ row, onDone }: { row: GridRow; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {row.correctable ? <CorrectionForm row={row} onDone={onDone} /> : null}
      {row.corrections.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">Corrections</p>
          <ol className="flex flex-col gap-1">
            {row.corrections.map((c) => (
              <li key={c.id}>
                <span className="text-slate-500">
                  {c.when} · {c.who}:
                </span>{' '}
                {c.change} — <em>{c.reason}</em>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

const INPUT =
  'rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700';

function CorrectionForm({ row, onDone }: { row: GridRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(correctEntry, null);
  const err = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="entry_id" value={row.id} />
      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="flex items-end gap-2">
          <legend className="mb-1 text-xs font-medium">Clock in</legend>
          <input
            type="date"
            name="in_date"
            defaultValue={row.defaults.in_date}
            className={INPUT}
            required
          />
          <input
            type="time"
            name="in_time"
            defaultValue={row.defaults.in_time}
            className={INPUT}
            required
          />
        </fieldset>
        <fieldset className="flex items-end gap-2">
          <legend className="mb-1 text-xs font-medium">
            Clock out <span className="text-slate-500">(next day for a night shift)</span>
          </legend>
          <input
            type="date"
            name="out_date"
            defaultValue={row.defaults.out_date}
            className={INPUT}
            required
          />
          <input
            type="time"
            name="out_time"
            defaultValue={row.defaults.out_time}
            className={INPUT}
            required
          />
        </fieldset>
        <label className="flex min-w-72 flex-1 flex-col gap-1 text-xs font-medium">
          Reason (kept in the audit log)
          <input
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            placeholder="e.g. Phone died; site manager confirmed he left at 06:00"
            className={INPUT}
          />
        </label>
      </div>
      {err.out_time || err.reason || err.in_date || err.out_date ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          {err.out_time ?? err.reason ?? err.in_date ?? err.out_date}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save correction'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
