'use client';

import {
  EMPLOYMENT_STATUSES,
  type EmploymentStatus,
  USER_ROLES,
  type UserRole,
} from '@deltaguard/shared';
import { type FormEvent, useActionState } from 'react';

import { Button, FormMessage, Select } from '@/components/ui';

import { changeRole, resetDevice, setEmploymentStatus } from './actions';

type Props = {
  userId: string;
  name: string;
  role: UserRole;
  status: EmploymentStatus;
  hasDevice: boolean;
};

const confirmOrCancel = (message: string) => (event: FormEvent<HTMLFormElement>) => {
  if (!window.confirm(message)) event.preventDefault();
};

export function UserRowActions({ userId, name, role, status, hasDevice }: Props) {
  const [roleState, roleAction, rolePending] = useActionState(changeRole, null);
  const [statusState, statusAction, statusPending] = useActionState(setEmploymentStatus, null);
  const [deviceState, deviceAction, devicePending] = useActionState(resetDevice, null);

  return (
    <div className="flex flex-col gap-2">
      <form
        action={roleAction}
        onSubmit={confirmOrCancel(`Change ${name}'s role? They will be signed out everywhere.`)}
        className="flex gap-2"
      >
        <input type="hidden" name="user_id" value={userId} />
        <Select name="role" defaultValue={role} aria-label="Role">
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={rolePending}>
          Set role
        </Button>
      </form>

      <form
        action={statusAction}
        onSubmit={(event) => {
          const next = new FormData(event.currentTarget).get('employment_status');
          const warning =
            next === 'active'
              ? `Reactivate ${name}? They will be able to sign in again.`
              : `Mark ${name} as ${String(next)}? This signs them out everywhere, revokes their devices and blocks sign-in.`;
          confirmOrCancel(warning)(event);
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="user_id" value={userId} />
        <Select name="employment_status" defaultValue={status} aria-label="Employment status">
          {EMPLOYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={statusPending}>
          Set status
        </Button>
      </form>

      <form
        action={deviceAction}
        onSubmit={confirmOrCancel(
          `Reset ${name}'s device? They will need to register their phone again.`,
        )}
      >
        <input type="hidden" name="user_id" value={userId} />
        <Button type="submit" variant="danger" disabled={devicePending || !hasDevice}>
          Reset device
        </Button>
      </form>

      <FormMessage state={roleState} />
      <FormMessage state={statusState} />
      <FormMessage state={deviceState} />
    </div>
  );
}
