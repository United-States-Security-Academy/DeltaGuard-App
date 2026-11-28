'use client';

import { useActionState, useState } from 'react';

import { Button, Field, FormMessage, Select } from '@/components/ui';

import { createLessonAssignment, grantExtraAttempt } from '../actions';

type Option = { value: string; label: string };

/** Assign to an officer, a site or a role; optional due date and qualification. */
export function AssignLessonForm({
  lessonId,
  officers,
  sites,
  qualificationTypes,
}: {
  lessonId: string;
  officers: Option[];
  sites: Option[];
  qualificationTypes: string[];
}) {
  const [state, action, pending] = useActionState(createLessonAssignment, null);
  const [target, setTarget] = useState<'officer' | 'site' | 'role'>('officer');
  const err = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="lesson_id" value={lessonId} />
      <input type="hidden" name="target" value={target} />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1.5 text-sm font-medium">Assign to</legend>
        {(
          [
            ['officer', 'An officer'],
            ['site', 'Everyone at a site'],
            ['role', 'Everyone with a role'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTarget(value)}
            className={`rounded-full border px-3 py-1.5 text-sm ${target === value ? 'border-gold bg-gold/20 font-medium' : 'border-line'}`}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        {target === 'officer' ? (
          <Select label="Officer" name="officer_id" required defaultValue="">
            <option value="" disabled>
              Choose an officer
            </option>
            {officers.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : target === 'site' ? (
          <Select label="Site" name="site_id" required defaultValue="">
            <option value="" disabled>
              Choose a site
            </option>
            {sites.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <Select label="Role" name="role" required defaultValue="officer">
            <option value="officer">Officers</option>
            <option value="supervisor">Supervisors</option>
            <option value="admin">Admins</option>
          </Select>
        )}
        <Field label="Due date (optional)" name="due_date" type="date" error={err.due_date} />
        <Field label="Due time" name="due_time" type="time" defaultValue="23:59" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Qualification granted on passing (optional)"
          name="creates_qualification_type"
          list="qualification-types"
          maxLength={100}
          placeholder="e.g. Fire safety"
          error={err.creates_qualification_type}
        />
        <datalist id="qualification-types">
          {qualificationTypes.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <Field
          label="Valid for (months, blank = no expiry)"
          name="qualification_valid_months"
          type="number"
          min={1}
          max={240}
          error={err.qualification_valid_months}
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Assigning…' : 'Assign and notify'}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** "Give one more attempt" for one officer, with an optional reason for the log. */
export function GrantAttemptButton({
  assessmentId,
  officerId,
}: {
  assessmentId: string;
  officerId: string;
}) {
  const [state, action, pending] = useActionState(grantExtraAttempt, null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-muted hover:underline"
        onClick={() => setOpen(true)}
      >
        + 1 attempt
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="assessment_id" value={assessmentId} />
      <input type="hidden" name="officer_id" value={officerId} />
      <input
        name="reason"
        maxLength={500}
        placeholder="Reason (optional)"
        className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <Button type="submit" disabled={pending} className="px-3 py-1 text-xs">
          {pending ? '…' : 'Grant'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1 text-xs"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
