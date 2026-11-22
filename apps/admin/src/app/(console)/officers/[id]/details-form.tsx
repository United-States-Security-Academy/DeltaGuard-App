'use client';

import { useActionState } from 'react';

import { Button, Field, FormMessage, Textarea } from '@/components/ui';

import { saveOfficerDetails } from '../actions';

export type OfficerDetailsValues = {
  userId: string;
  fullName: string;
  phone: string;
  employeeNumber: string;
  address: string;
  dateHired: string;
  contactName: string;
  contactRelationship: string;
  contactPhone: string;
};

export function OfficerDetailsForm({ values }: { values: OfficerDetailsValues }) {
  const [state, action, pending] = useActionState(saveOfficerDetails, null);
  const err = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="user_id" value={values.userId} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Contact</legend>
        <Field
          label="Full name"
          name="full_name"
          defaultValue={values.fullName}
          required
          error={err.full_name}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          placeholder="+2348012345678"
          defaultValue={values.phone}
          error={err.phone}
        />
        <div className="sm:col-span-2">
          <Textarea
            label="Home address"
            name="address"
            defaultValue={values.address}
            error={err.address}
            rows={2}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Employment</legend>
        <Field
          label="Employee number"
          name="employee_number"
          defaultValue={values.employeeNumber}
          error={err.employee_number}
        />
        <Field
          label="Date hired"
          name="date_hired"
          type="date"
          defaultValue={values.dateHired}
          error={err.date_hired}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Emergency contact</legend>
        <Field label="Name" name="ec_name" defaultValue={values.contactName} error={err.ec_name} />
        <Field
          label="Relationship"
          name="ec_relationship"
          placeholder="e.g. Spouse"
          defaultValue={values.contactRelationship}
          error={err.ec_relationship}
        />
        <Field
          label="Phone"
          name="ec_phone"
          type="tel"
          placeholder="+2348012345678"
          defaultValue={values.contactPhone}
          error={err.ec_phone}
        />
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
