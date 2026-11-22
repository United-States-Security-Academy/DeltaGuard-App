'use client';

import type { IncidentStatus } from '@deltaguard/shared';
import { useActionState } from 'react';

import { Button, FormMessage, Textarea } from '@/components/ui';

import { reviewIncident } from '../actions';

/** Review buttons for a report that is submitted or under review. */
export function ReviewForm({ id, status }: { id: string; status: IncidentStatus }) {
  const [state, action, pending] = useActionState(reviewIncident, null);
  const err = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Textarea
        label="Notes for the officer"
        name="notes"
        rows={4}
        maxLength={4000}
        placeholder="Required when returning: say what needs to be added or corrected."
        error={err.notes}
      />
      <div className="flex flex-wrap items-center gap-2">
        {status === 'submitted' ? (
          <Button
            type="submit"
            name="status"
            value="under_review"
            variant="secondary"
            disabled={pending}
          >
            Start review
          </Button>
        ) : null}
        <Button type="submit" name="status" value="approved" disabled={pending}>
          Approve
        </Button>
        <Button type="submit" name="status" value="returned" variant="danger" disabled={pending}>
          Return to officer
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
