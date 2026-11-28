'use client';

import { useActionState } from 'react';

import { Button, FormMessage, Textarea } from '@/components/ui';

import { reviewFormSubmission } from '../../actions';

/** Approve, or return with notes. Either way the officer gets a notification. */
export function ReviewForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(reviewFormSubmission, null);
  const err = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Textarea
        label="Notes for the officer"
        name="notes"
        rows={4}
        maxLength={4000}
        placeholder="Required when returning: say what needs to be fixed."
        error={err.notes || undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="status" value="approved" disabled={pending}>
          Approve
        </Button>
        <Button type="submit" name="status" value="returned" variant="danger" disabled={pending}>
          Return to officer
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
