'use client';

import { useActionState } from 'react';

import { Button, Field, FormMessage, Textarea } from '@/components/ui';

import { updateFormDetails } from '../actions';

export function DetailsForm({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string | null;
}) {
  const [state, action, pending] = useActionState(updateFormDetails, null);
  const err = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Field
        label="Title"
        name="title"
        defaultValue={title}
        required
        maxLength={200}
        error={err.title}
      />
      <Textarea
        label="Description (shown to officers)"
        name="description"
        defaultValue={description ?? ''}
        rows={2}
        maxLength={4000}
        error={err.description}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
