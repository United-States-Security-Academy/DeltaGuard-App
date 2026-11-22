'use client';

import { addDaysIso, formatDate, SHIFT_REPEAT_MAX_WEEKS } from '@deltaguard/shared';
import { type ReactNode, useActionState, useEffect, useState } from 'react';

import { Button, Field, FormMessage, Select, Textarea } from '@/components/ui';

import { checkShift, createShift, type ShiftCheck, updateShift } from './actions';

export type ShiftFormValues = {
  site_id: string;
  officer_id: string;
  date: string;
  start_time: string;
  end_time: string;
  notes: string;
};

type Option = { id: string; name: string };

/**
 * Create or edit a shift. Times are wall-clock times in the company time
 * zone; an end time at or before the start means it ends the next day.
 * While the form is filled in it asks the server what would go wrong
 * (overlaps, expired licences, officer not assigned) and shows it before
 * Save. The server re-checks everything on submit.
 */
export function ShiftForm({
  shiftId,
  initial,
  sites,
  officers,
  assignments,
  view,
  timeZone,
}: {
  /** Set when editing. */
  shiftId?: string;
  initial: ShiftFormValues;
  sites: (Option & { clientName: string | null })[];
  officers: Option[];
  /** site id → ids of officers assigned there */
  assignments: Record<string, string[]>;
  view: 'site' | 'officer';
  timeZone: string;
}) {
  const editing = shiftId !== undefined;
  const [state, formAction, pending] = useActionState(editing ? updateShift : createShift, null);
  const [values, setValues] = useState({ ...initial, repeat_weeks: 1 });
  const [check, setCheck] = useState<{ key: string; result: ShiftCheck | null } | null>(null);
  const err = state?.fieldErrors ?? {};

  const set = (name: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((v) => ({
      ...v,
      [name]: name === 'repeat_weeks' ? Number(event.target.value) : event.target.value,
    }));

  // Ask the server about clashes once the inputs settle.
  const checkKey = JSON.stringify({
    site_id: values.site_id,
    officer_id: values.officer_id,
    date: values.date,
    start_time: values.start_time,
    end_time: values.end_time,
    repeat_weeks: values.repeat_weeks,
  });
  const ready = Boolean(
    values.site_id && values.officer_id && values.date && values.start_time && values.end_time,
  );
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const result = await checkShift({ ...JSON.parse(checkKey), exclude_shift_id: shiftId }).catch(
        () => null,
      );
      if (!stale) setCheck({ key: checkKey, result });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [checkKey, ready, shiftId]);
  const live = ready && check?.key === checkKey ? check.result : null;

  const assigned = new Set(values.site_id ? (assignments[values.site_id] ?? []) : []);
  const officerSites = new Set(
    Object.entries(assignments)
      .filter(([, ids]) => ids.includes(values.officer_id))
      .map(([siteId]) => siteId),
  );
  const overnight = values.start_time && values.end_time && values.end_time <= values.start_time;
  const repeating = !editing && values.repeat_weeks > 1;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {editing ? <input type="hidden" name="id" value={shiftId} /> : null}
      <input type="hidden" name="view" value={view} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Site"
          name="site_id"
          required
          value={values.site_id}
          onChange={set('site_id')}
        >
          <option value="" disabled>
            Choose a site
          </option>
          {values.officer_id && officerSites.size > 0 ? (
            <optgroup label="This officer’s sites">
              {sites
                .filter((s) => officerSites.has(s.id))
                .map((s) => (
                  <SiteOption key={s.id} site={s} />
                ))}
            </optgroup>
          ) : null}
          <optgroup
            label={values.officer_id && officerSites.size > 0 ? 'Other sites' : 'All sites'}
          >
            {sites
              .filter((s) => !(values.officer_id && officerSites.has(s.id)))
              .map((s) => (
                <SiteOption key={s.id} site={s} />
              ))}
          </optgroup>
        </Select>

        <div className="flex flex-col gap-1">
          <Select
            label="Officer"
            name="officer_id"
            required
            value={values.officer_id}
            onChange={set('officer_id')}
          >
            <option value="" disabled>
              Choose an officer
            </option>
            {values.site_id ? (
              <>
                <optgroup label="Assigned to this site">
                  {officers
                    .filter((o) => assigned.has(o.id))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Not assigned to this site">
                  {officers
                    .filter((o) => !assigned.has(o.id))
                    .map((o) => (
                      <option key={o.id} value={o.id} disabled={o.id !== values.officer_id}>
                        {o.name}
                      </option>
                    ))}
                </optgroup>
              </>
            ) : (
              officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))
            )}
          </Select>
          {err.officer_id ? (
            <span className="text-sm text-red-600 dark:text-red-400">{err.officer_id}</span>
          ) : values.site_id && assigned.size === 0 ? (
            <span className="text-sm text-slate-500">
              Nobody is assigned to this site yet. Assign officers on the site page.
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Date"
          name="date"
          type="date"
          required
          value={values.date}
          onChange={set('date')}
          error={err.date}
        />
        <Field
          label="Starts"
          name="start_time"
          type="time"
          required
          value={values.start_time}
          onChange={set('start_time')}
          error={err.start_time}
        />
        <div className="flex flex-col gap-1">
          <Field
            label="Ends"
            name="end_time"
            type="time"
            required
            value={values.end_time}
            onChange={set('end_time')}
            error={err.end_time ?? err.ends_at}
          />
          {overnight ? <span className="text-sm text-slate-500">Ends the next day</span> : null}
        </div>
        {editing ? null : (
          <Select
            label="Repeat weekly"
            name="repeat_weeks"
            value={String(values.repeat_weeks)}
            onChange={set('repeat_weeks')}
          >
            <option value="1">Don’t repeat</option>
            {Array.from({ length: SHIFT_REPEAT_MAX_WEEKS - 1 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n} weeks
              </option>
            ))}
          </Select>
        )}
      </div>

      <p className="-mt-2 text-xs text-slate-500">
        Times are in {timeZone.replace('_', ' ')} time.
        {repeating && values.date
          ? ` Creates ${values.repeat_weeks} shifts, the last on ${formatDate(addDaysIso(values.date, (values.repeat_weeks - 1) * 7))}.`
          : null}
      </p>

      <Textarea
        label="Notes for the officer (optional)"
        name="notes"
        value={values.notes}
        onChange={set('notes')}
        maxLength={2000}
        error={err.notes}
      />

      <Warnings check={live} repeating={repeating} />

      <div className="flex flex-col items-start gap-2">
        <Button type="submit" disabled={pending}>
          {pending
            ? 'Saving…'
            : editing
              ? 'Save changes'
              : repeating
                ? `Create ${values.repeat_weeks} shifts`
                : 'Create shift'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function SiteOption({ site }: { site: Option & { clientName: string | null } }) {
  return (
    <option value={site.id}>
      {site.name}
      {site.clientName ? ` · ${site.clientName}` : ''}
    </option>
  );
}

/** Server-checked problems, shown before Save. The checkboxes are read by the server action. */
function Warnings({ check, repeating }: { check: ShiftCheck | null; repeating: boolean }) {
  if (!check) return null;
  const { overlaps, licences, officerProblem, inputError } = check;
  if (!overlaps.length && !licences.length && !officerProblem && !inputError) return null;

  return (
    <div className="flex flex-col gap-3">
      {inputError || officerProblem ? (
        <Alert tone="bad" title={inputError ?? officerProblem ?? ''} />
      ) : null}

      {overlaps.length > 0 ? (
        <Alert tone="bad" title="Overlapping shifts">
          <ul className="list-disc pl-5">
            {overlaps.map((o) => (
              <li key={`${o.date}-${o.shiftId}`}>
                {formatDate(o.date)}: already at {o.siteName} ({o.when})
              </li>
            ))}
          </ul>
          {repeating ? (
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" name="skip_conflicts" />
              Skip the weeks that clash and create the rest
            </label>
          ) : (
            <p className="mt-1">
              An officer can’t work two shifts at once. Change the time or officer.
            </p>
          )}
        </Alert>
      ) : null}

      {licences.length > 0 ? (
        <Alert tone="warn" title="Licence problem">
          <ul className="list-disc pl-5">
            {licences.map((l) => (
              <li key={l.type}>{l.message}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" name="confirm_licence" />
            Schedule anyway
          </label>
        </Alert>
      ) : null}
    </div>
  );
}

function Alert({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'bad';
  title: string;
  children?: ReactNode;
}) {
  const styles =
    tone === 'bad'
      ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200'
      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200';
  return (
    <div role="alert" className={`rounded-lg border p-3 text-sm ${styles}`}>
      <p className="font-medium">{title}</p>
      {children}
    </div>
  );
}
