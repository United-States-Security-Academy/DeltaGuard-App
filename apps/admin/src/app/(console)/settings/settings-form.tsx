'use client';

import { useActionState, useEffect, useState } from 'react';

import { Button, Field, FormMessage, Select } from '@/components/ui';

import { updateSettings } from './actions';

type Settings = {
  time_zone: string;
  late_grace_minutes: number;
  early_clock_in_minutes: number;
  low_accuracy_threshold_m: number;
  integrity_enforcement: string;
};

type ZoneGroup = { label: string; zones: { value: string; label: string }[] };

function formatNow(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(now);
  } catch {
    return '';
  }
}

export function SettingsForm({ settings, zones }: { settings: Settings; zones: ZoneGroup[] }) {
  const [state, action, pending] = useActionState(updateSettings, null);
  const [zone, setZone] = useState(settings.time_zone);
  // Rendered after mount only, so server and browser HTML match.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const errors = state?.fieldErrors;
  const zoneChanged = zone !== settings.time_zone;

  return (
    <form action={action} className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Time zone</h2>
        <p className="text-sm text-muted">
          Used for shift times typed in the console, where each day and week starts, late and missed
          checks, and which day a timesheet entry belongs to.
        </p>
        <div className="max-w-md">
          <Select
            label="Company time zone"
            name="time_zone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {zones.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.zones.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {errors?.time_zone ? (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.time_zone}</p>
          ) : null}
          {now ? <p className="mt-1.5 text-sm text-muted">Now: {formatNow(zone, now)}</p> : null}
        </div>
        {zoneChanged ? (
          <p className="max-w-2xl rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            Existing shifts keep their exact moment in time, so they will show at different clock
            times in the new zone (a 07:00 shift in the old zone may show as the night before).
            Check upcoming shifts on the schedule after saving. Timesheet entries already recorded
            keep their work date.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Clock-in rules</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Late after (minutes)"
            name="late_grace_minutes"
            type="number"
            min={0}
            max={240}
            required
            defaultValue={settings.late_grace_minutes}
            error={errors?.late_grace_minutes}
          />
          <Field
            label="Clock-in opens before start (minutes)"
            name="early_clock_in_minutes"
            type="number"
            min={0}
            max={720}
            required
            defaultValue={settings.early_clock_in_minutes}
            error={errors?.early_clock_in_minutes}
          />
          <Field
            label="Flag GPS accuracy worse than (metres)"
            name="low_accuracy_threshold_m"
            type="number"
            min={5}
            max={5000}
            required
            defaultValue={settings.low_accuracy_threshold_m}
            error={errors?.low_accuracy_threshold_m}
          />
        </div>
        <p className="text-sm text-muted">
          A clock-in later than the start time plus the grace period is flagged late. With no
          clock-in by then, the shift is marked missed a few minutes later.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Phone security</h2>
        <p className="max-w-2xl text-sm text-muted">
          Phones are checked with Apple App Attest / Google Play Integrity, and report rooting,
          emulators and fake-location apps. Supervisors are always told. Choose what happens to
          clock-ins, quiz submissions and form signing from a phone that fails.
        </p>
        <div className="max-w-md">
          <Select
            label="Phones that fail the check"
            name="integrity_enforcement"
            defaultValue={settings.integrity_enforcement}
          >
            <option value="monitor">Flag their actions (recommended to start)</option>
            <option value="block">Refuse clock-in, quizzes and form signing</option>
          </Select>
        </div>
        <p className="max-w-2xl text-sm text-muted">
          A phone whose check couldn&apos;t run (no connection, service not set up) is only ever
          flagged, never refused.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
