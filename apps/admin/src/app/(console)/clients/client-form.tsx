'use client';

import { useActionState } from 'react';

import { Button, Field, FormMessage, Textarea } from '@/components/ui';

import { addClient, updateClient } from './actions';

export type ClientValues = {
  id?: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  notes: string;
};

const EMPTY: ClientValues = { name: '', contactPerson: '', phone: '', email: '', notes: '' };

/** Create (no id) or edit (with id) a client. */
export function ClientForm({ values = EMPTY }: { values?: ClientValues }) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState(editing ? updateClient : addClient, null);
  const err = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required defaultValue={values.name} error={err.name} />
        <Field
          label="Contact person"
          name="contact_person"
          defaultValue={values.contactPerson}
          error={err.contact_person}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          placeholder="+2348012345678"
          defaultValue={values.phone}
          error={err.phone}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={values.email}
          error={err.email}
        />
      </div>
      <Textarea label="Notes" name="notes" rows={3} defaultValue={values.notes} error={err.notes} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save client' : 'Add client'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
