-- Phase 5: officers acknowledge shifts, and clock events recorded offline.
--
-- 1. acknowledge_shift(): officers have no UPDATE policy on shifts (they must
--    not edit times or sites), so acknowledging goes through this security
--    definer function, which only moves their own 'scheduled' shift to
--    'acknowledged' and stamps shifts.acknowledged_at.
-- 2. clock_event(p_queued): a phone with no internet keeps the clock event
--    (GPS fix + its own clock) and sends it later. Without this, the server
--    would judge it by the time it arrives: a clock-in made on time would be
--    flagged late, or refused because the shift had ended. Queued events are
--    judged by the phone's clock instead, within limits, and always carry the
--    'delayed' flag so supervisors know the time came from the phone.
--    recorded_at keeps meaning "when the server received it".

-- ---------------------------------------------------------------------------
-- shifts.acknowledged_at
-- ---------------------------------------------------------------------------

alter table public.shifts add column acknowledged_at timestamptz;

comment on column public.shifts.acknowledged_at is
  'When the officer acknowledged the shift (server time). Set only by acknowledge_shift(); cleared when the shift goes back to scheduled.';

-- Clients can't set acknowledged_at themselves (only acknowledge_shift() can),
-- and a shift that goes back to 'scheduled' (the console does this when the
-- officer, site or times change) needs acknowledging again.
create function public.shifts_acknowledged_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.acknowledged_at := case when tg_op = 'UPDATE' then old.acknowledged_at end;
  end if;
  if new.status = 'scheduled' then
    new.acknowledged_at := null;
  end if;
  return new;
end;
$$;

create trigger shifts_acknowledged_at
  before insert or update on public.shifts
  for each row execute function public.shifts_acknowledged_at();

-- ---------------------------------------------------------------------------
-- acknowledge_shift
-- ---------------------------------------------------------------------------

create function public.acknowledge_shift(p_shift_id uuid)
returns public.shifts
language plpgsql
security definer -- officers can't update shifts directly
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.officer_id <> v_uid then
    raise exception 'Shift not found' using errcode = '42501';
  end if;

  -- Tapping twice (or a retry after a lost response) is fine.
  if v_shift.status = 'acknowledged' then
    return v_shift;
  end if;
  if v_shift.status <> 'scheduled' then
    raise exception 'This shift is %', replace(v_shift.status::text, '_', ' ') using errcode = 'P0001';
  end if;
  if v_shift.ends_at <= now() then
    raise exception 'This shift has already ended' using errcode = 'P0001';
  end if;

  update public.shifts
     set status = 'acknowledged', acknowledged_at = now()
   where id = v_shift.id
  returning * into v_shift;

  return v_shift;
end;
$$;

comment on function public.acknowledge_shift is
  'The caller acknowledges their own scheduled shift. Idempotent.';

revoke execute on function public.acknowledge_shift from public, anon;
grant execute on function public.acknowledge_shift to authenticated;

-- ---------------------------------------------------------------------------
-- 'delayed' attendance flag
-- ---------------------------------------------------------------------------

alter table public.attendance_events drop constraint attendance_events_flags_check;
alter table public.attendance_events add constraint attendance_events_flags_check check (
  flags <@ array[
    'late', 'early_leave', 'out_of_range', 'mock_location', 'low_accuracy', 'wrong_device', 'delayed'
  ]
);

-- ---------------------------------------------------------------------------
-- clock_event with p_queued
-- ---------------------------------------------------------------------------

-- Adding a parameter would create an overload, so replace the function.
drop function public.clock_event(
  uuid, public.attendance_type, double precision, double precision, double precision, boolean, text, timestamptz
);

create function public.clock_event(
  p_shift_id uuid,
  p_type public.attendance_type,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_is_mock_location boolean,
  p_device_id text,
  p_device_time timestamptz default null,
  -- true: the phone was offline and is sending this later. p_device_time is
  -- then when it happened, and is what the time rules are checked against.
  p_queued boolean default false
)
returns public.attendance_events
language plpgsql
security definer -- writes attendance and shift status, which officers can't do directly
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now(); -- server time; stored as recorded_at
  -- The time the time rules are checked against: server time, or for a
  -- queued event, the phone's time (bounded below).
  v_at timestamptz := now();
  v_shift public.shifts;
  v_site public.sites;
  v_settings public.settings;
  v_flags text[] := '{}';
  v_distance double precision;
  v_event public.attendance_events;
begin
  -- Who is calling --------------------------------------------------------
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  -- Inputs ----------------------------------------------------------------
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'A valid location is required to clock in or out' using errcode = '22023';
  end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'Invalid location accuracy' using errcode = '22023';
  end if;
  if p_device_id is null or char_length(p_device_id) not between 1 and 200 then
    raise exception 'Invalid device' using errcode = '22023';
  end if;

  if coalesce(p_queued, false) then
    if p_device_time is null then
      raise exception 'A delayed clock event needs the time it happened' using errcode = '22023';
    end if;
    -- A phone clock running a few minutes fast is normal; more is not.
    if p_device_time > v_now + interval '5 minutes' then
      raise exception 'The time on this phone is wrong. Set it to automatic and try again'
        using errcode = '22023';
    end if;
    if p_device_time < v_now - interval '72 hours' then
      raise exception 'This clock event is more than 72 hours old. Ask your supervisor to correct your timesheet'
        using errcode = 'P0001';
    end if;
    v_at := least(p_device_time, v_now);
    v_flags := array_append(v_flags, 'delayed');
  end if;

  -- The shift must be the caller's. Locked so two taps can't race. -----
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.officer_id <> v_uid then
    -- Same message whether it doesn't exist or isn't theirs.
    raise exception 'Shift not found' using errcode = '42501';
  end if;

  select * into v_settings from public.settings where id;
  select * into v_site from public.sites where id = v_shift.site_id;

  -- Registered device: refuse, but keep a record of the attempt. --------
  if not exists (
    select 1 from public.user_devices d
     where d.user_id = v_uid and d.device_id = p_device_id and d.revoked_at is null
  ) then
    insert into public.attendance_events (
      shift_id, officer_id, type, recorded_at, device_time, latitude, longitude,
      accuracy_m, is_mock_location, device_id, flags, accepted
    ) values (
      v_shift.id, v_uid, p_type, v_now, p_device_time, round(p_latitude::numeric, 6),
      round(p_longitude::numeric, 6), round(p_accuracy_m::numeric, 1),
      coalesce(p_is_mock_location, false), p_device_id, array_append(v_flags, 'wrong_device'), false
    )
    returning * into v_event;
    return v_event;
  end if;

  -- Rules per event type --------------------------------------------------
  if v_shift.status in ('cancelled', 'completed') then
    raise exception 'This shift is %', v_shift.status using errcode = 'P0001';
  end if;

  if p_type = 'clock_in' then
    if exists (select 1 from public.attendance_events
                where shift_id = v_shift.id and type = 'clock_in' and accepted) then
      raise exception 'Already clocked in for this shift' using errcode = '23505';
    end if;
    if v_at < v_shift.starts_at - make_interval(mins => v_settings.early_clock_in_minutes) then
      raise exception 'Too early to clock in: you can clock in % minutes before the shift starts',
        v_settings.early_clock_in_minutes using errcode = 'P0001';
    end if;
    if v_at >= v_shift.ends_at then
      raise exception 'This shift has already ended' using errcode = 'P0001';
    end if;
    if v_at > v_shift.starts_at + make_interval(mins => v_settings.late_grace_minutes) then
      v_flags := array_append(v_flags, 'late');
    end if;
  else
    if not exists (select 1 from public.attendance_events
                    where shift_id = v_shift.id and type = 'clock_in' and accepted) then
      raise exception 'You need to clock in before you can clock out' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.attendance_events
                where shift_id = v_shift.id and type = 'clock_out' and accepted) then
      raise exception 'Already clocked out of this shift' using errcode = '23505';
    end if;
    if v_at < v_shift.ends_at then
      v_flags := array_append(v_flags, 'early_leave');
    end if;
  end if;

  -- Location checks ------------------------------------------------------
  if v_site.latitude is not null and v_site.longitude is not null then
    v_distance := public.distance_m(
      p_latitude, p_longitude, v_site.latitude::double precision, v_site.longitude::double precision
    );
    if v_distance > v_site.clock_in_radius_m then
      v_flags := array_append(v_flags, 'out_of_range');
    end if;
  end if;
  if coalesce(p_is_mock_location, false) then
    v_flags := array_append(v_flags, 'mock_location');
  end if;
  if p_accuracy_m is null or p_accuracy_m > v_settings.low_accuracy_threshold_m then
    v_flags := array_append(v_flags, 'low_accuracy');
  end if;

  -- Record it and move the shift along -----------------------------------
  insert into public.attendance_events (
    shift_id, officer_id, type, recorded_at, device_time, latitude, longitude, accuracy_m,
    distance_from_site_m, is_mock_location, device_id, flags, accepted
  ) values (
    v_shift.id, v_uid, p_type, v_now, p_device_time, round(p_latitude::numeric, 6),
    round(p_longitude::numeric, 6), round(p_accuracy_m::numeric, 1),
    round(v_distance::numeric, 1), coalesce(p_is_mock_location, false), p_device_id, v_flags, true
  )
  returning * into v_event;

  update public.shifts
     set status = case when p_type = 'clock_in' then 'in_progress' else 'completed' end::public.shift_status
   where id = v_shift.id;

  return v_event;
end;
$$;

comment on function public.clock_event is
  'Clock in/out for the caller''s own shift from their registered device. Server time, or the phone''s time (flagged delayed) for events queued offline; flags exceptions.';

revoke execute on function public.clock_event from public, anon;
grant execute on function public.clock_event to authenticated;
