-- Phase 14: officers can clock in only on site.
--
-- clock_event() used to accept a clock-in from anywhere and flag it
-- out_of_range / mock_location. Now a clock-in is refused (SQLSTATE DG002,
-- NOT_ON_SITE_CODE in packages/shared) when:
--   - the phone reports a mock (fake GPS) location, or
--   - the fix is farther from the site than its clock_in_radius_m, allowing up
--     to 50 m for the fix's reported accuracy.
-- This applies to queued (offline) clock-ins too: the fix taken at the time is
-- judged. Sites without coordinates can't be checked and are not refused.
-- Clock-out is unchanged (flagged, never refused).
-- Same signature, so grants are kept.

create or replace function public.clock_event(
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
  p_queued boolean default false,
  -- Clock-out only: a note for the next officer at the site.
  p_handover_note text default null
)
returns public.attendance_events
language plpgsql
security definer -- writes attendance, shift status and reports, which officers can't do directly
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
  v_note text := nullif(btrim(p_handover_note), '');
  v_report_id uuid;
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
  if v_note is not null and p_type <> 'clock_out' then
    raise exception 'A handover note can only be left at clock-out' using errcode = '22023';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'The handover note is too long (2000 characters at most)' using errcode = '22023';
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
    if public.post_orders_pending(v_shift.site_id, v_uid, v_at) > 0 then
      if not coalesce(p_queued, false) then
        raise exception 'Read and acknowledge the latest post orders for % before you clock in',
          v_site.name using errcode = 'DG001';
      end if;
      v_flags := array_append(v_flags, 'post_orders_unread');
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
  end if;

  -- Clock-in only on site (DG002). A fix "r m away, accurate to a m" may
  -- really be up to a m closer, so up to 50 m of the reported accuracy counts
  -- in the officer's favour (capped, or a vague fix would let anyone in).
  -- Clock-out is never refused: an officer who has left must still be able to
  -- end the shift; it is flagged instead.
  if p_type = 'clock_in' then
    if coalesce(p_is_mock_location, false) then
      raise exception 'Fake GPS is on for this phone. Turn off any mock location app and try again'
        using errcode = 'DG002';
    end if;
    if v_distance is not null
       and v_distance - least(coalesce(p_accuracy_m, 0), 50) > v_site.clock_in_radius_m then
      raise exception 'You are % m from %. You can clock in only within % m of the site',
        round(v_distance)::bigint, v_site.name, v_site.clock_in_radius_m
        using errcode = 'DG002';
    end if;
  end if;

  if v_distance > v_site.clock_in_radius_m then
    v_flags := array_append(v_flags, 'out_of_range');
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

  -- The shift's daily activity report (normally created at clock-in).
  insert into public.daily_activity_reports (shift_id, officer_id)
  values (v_shift.id, v_uid)
  on conflict (shift_id) do nothing;

  if v_note is not null then
    select id into v_report_id from public.daily_activity_reports where shift_id = v_shift.id;
    insert into public.dar_entries (report_id, officer_id, occurred_at, type, description)
    values (v_report_id, v_uid, v_at, 'handover', v_note);
  end if;

  return v_event;
end;
$$;

comment on function public.clock_event is
  'Clock in/out for the caller''s own shift from their registered device. Clock-in only on site (within the radius, no mock location; DG002). Live clock-ins require acknowledged post orders (DG001). Queued events use the phone''s time (flagged delayed). Clock-out may leave a handover note.';
