import {
  attendanceFlagLabel,
  firstParam,
  formatDate,
  formatTimeRange,
  isEditableShiftStatus,
  recordIdSchema,
  startOfWeekIso,
  toZoned,
} from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { ActionButton } from '@/components/action-form';
import { ShiftStatusBadge } from '@/components/status';
import { Badge, Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { cancelShift } from '../actions';
import { getTimeZone, loadFormOptions } from '../data';
import { ShiftWelfare } from '../../welfare/shift-welfare';
import { ShiftForm } from '../shift-form';
import { loadFailed } from '@/lib/server-errors';

type Props = PageProps<'/schedule/[id]'>;

const viewSchema = z.preprocess(firstParam, z.enum(['site', 'officer'])).catch('site');

export default function ShiftPage({ params, searchParams }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-slate-500">Loading shift…</p>}>
        <ShiftContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ShiftContent({ params, searchParams }: Props) {
  const staff = await requireStaff();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();
  const view = viewSchema.parse((await searchParams).view);

  const supabase = await createClient();
  const [shiftResult, events, timeZone] = await Promise.all([
    supabase
      .from('shifts')
      .select(
        '*, sites(id, name), officer:profiles!shifts_officer_id_fkey(id, full_name, phone), creator:profiles!shifts_created_by_fkey(full_name)',
      )
      .eq('id', id.data.id)
      .maybeSingle(),
    supabase
      .from('attendance_events')
      .select('id, type, recorded_at, flags, accepted, distance_from_site_m, accuracy_m')
      .eq('shift_id', id.data.id)
      .order('recorded_at'),
    getTimeZone(supabase),
  ]);
  if (shiftResult.error) {
    return <ErrorText>{loadFailed('this shift', shiftResult.error)}</ErrorText>;
  }
  const shift = shiftResult.data;
  if (!shift) notFound();

  const start = toZoned(shift.starts_at, timeZone);
  const end = toZoned(shift.ends_at, timeZone);
  const editable = isEditableShiftStatus(shift.status);
  const options = editable ? await loadFormOptions(supabase) : null;
  const officerName = shift.officer?.full_name ?? 'Unnamed officer';

  return (
    <>
      <Link
        href={`/schedule?view=${view}&week=${startOfWeekIso(start.date)}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← Week of {formatDate(startOfWeekIso(start.date))}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {shift.sites?.name ?? 'Shift'} · {formatDate(start.date)}
          </h1>
          <p className="text-slate-500">
            <Link href={`/officers/${shift.officer_id}`} className="hover:underline">
              {officerName}
            </Link>
            {' · '}
            {formatTimeRange(shift.starts_at, shift.ends_at, timeZone)}
            {end.date !== start.date ? ' (next day)' : ''}
            {shift.creator?.full_name ? ` · Created by ${shift.creator.full_name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ShiftStatusBadge status={shift.status} />
          {editable ? (
            <ActionButton
              action={cancelShift}
              fields={{ id: shift.id }}
              label="Cancel shift"
              pendingLabel="Cancelling…"
              confirm={`Cancel ${officerName}'s shift on ${formatDate(start.date)}?`}
              variant="danger"
            />
          ) : null}
        </div>
      </div>

      {editable && options ? (
        <Card title="Edit shift">
          {shift.status === 'acknowledged' ? (
            <p className="mb-4 text-sm text-slate-500">
              The officer has acknowledged this shift. Changing the site, officer or times will ask
              them to acknowledge it again.
            </p>
          ) : null}
          <ShiftForm
            shiftId={shift.id}
            initial={{
              site_id: shift.site_id,
              officer_id: shift.officer_id,
              date: start.date,
              start_time: start.time,
              end_time: end.time,
              notes: shift.notes ?? '',
            }}
            // Keep the current site/officer selectable even if they've since been deactivated.
            sites={
              options.sites.some((s) => s.id === shift.site_id) || !shift.sites
                ? options.sites
                : [
                    { id: shift.sites.id, name: shift.sites.name, clientName: null },
                    ...options.sites,
                  ]
            }
            officers={
              options.officers.some((o) => o.id === shift.officer_id)
                ? options.officers
                : [{ id: shift.officer_id, name: officerName }, ...options.officers]
            }
            assignments={options.assignments}
            view={view}
            timeZone={timeZone}
          />
        </Card>
      ) : (
        <Card title="Details">
          <p className="text-sm text-slate-500">
            {shift.status === 'cancelled'
              ? 'This shift was cancelled.'
              : 'This shift has started, so it can no longer be edited or cancelled.'}
          </p>
          {shift.notes ? <p className="mt-2 text-sm whitespace-pre-wrap">{shift.notes}</p> : null}
        </Card>
      )}

      <Card title="Clock-in and clock-out">
        {events.error ? (
          <ErrorText>{loadFailed('attendance', events.error)}</ErrorText>
        ) : events.data.length === 0 ? (
          <EmptyState>No clock-in yet.</EmptyState>
        ) : (
          <Table head={['Event', 'Time', 'Distance from site', 'GPS accuracy', 'Flags']}>
            {events.data.map((e) => (
              <tr key={e.id} className={e.accepted ? '' : 'opacity-70'}>
                <td className="px-3 py-3 font-medium">
                  {e.type === 'clock_in' ? 'Clock-in' : 'Clock-out'}
                  {e.accepted ? null : (
                    <span className="ml-2">
                      <Badge tone="bad">Refused</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {formatDate(toZoned(e.recorded_at, timeZone).date)}{' '}
                  {toZoned(e.recorded_at, timeZone).time}
                </td>
                <td className="px-3 py-3">
                  {e.distance_from_site_m === null
                    ? '—'
                    : `${Math.round(e.distance_from_site_m)} m`}
                </td>
                <td className="px-3 py-3">
                  {e.accuracy_m === null ? '—' : `±${Math.round(e.accuracy_m)} m`}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {e.flags.length === 0 ? (
                      <Badge tone="good">OK</Badge>
                    ) : (
                      e.flags.map((f) => (
                        <Badge key={f} tone={f === 'late' || f === 'early_leave' ? 'warn' : 'bad'}>
                          {attendanceFlagLabel(f)}
                        </Badge>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {shift.status === 'in_progress' || shift.status === 'completed' ? (
        <ShiftWelfare
          supabase={supabase}
          shiftId={shift.id}
          shiftStatus={shift.status}
          timeZone={timeZone}
          isAdmin={staff.role === 'admin'}
        />
      ) : null}
    </>
  );
}
