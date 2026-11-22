-- Phase 3: shifts, attendance (GPS clock-in/out) and settings.
--
-- shifts             who works where and when
-- attendance_events  clock-in / clock-out records, append-only. Officers can
--                    only create them through public.clock_event(), never by
--                    inserting directly.
-- settings           one row of company-wide settings (late grace period…)
--
-- Access summary (every policy also requires is_active_user()):
--   admin       full access to shifts; reads attendance; edits settings
--   supervisor  reads, creates and edits shifts; reads attendance
--   officer     reads their own shifts and attendance; clocks in/out only
--               through clock_event()
--
-- Times: `recorded_at` is always the database's clock. The phone's clock is
-- stored in `device_time` for reference only, because a phone's time can be
-- changed by its user.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.shift_status as enum (
  'scheduled', 'acknowledged', 'in_progress', 'completed', 'missed', 'cancelled'
);
create type public.attendance_type as enum ('clock_in', 'clock_out');

-- ---------------------------------------------------------------------------
-- settings (exactly one row)
-- ---------------------------------------------------------------------------

create table public.settings (
  id boolean primary key default true check (id), -- only one row can exist
  -- A clock-in later than starts_at + this is flagged `late`; with no clock-in
  -- by then, the scheduled job marks the shift `missed`.
  late_grace_minutes integer not null default 10 check (late_grace_minutes between 0 and 240),
  -- How long before starts_at an officer may clock in.
  early_clock_in_minutes integer not null default 60 check (early_clock_in_minutes between 0 and 720),
  -- GPS accuracy worse than this (metres) is flagged `low_accuracy`.
  low_accuracy_threshold_m integer not null default 100 check (low_accuracy_threshold_m between 5 and 5000),
  updated_at timestamptz not null default now()
);

comment on table public.settings is 'Company-wide settings. Exactly one row (id = true).';

insert into public.settings (id) values (true);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  -- restrict: shifts are the attendance history; deactivate sites instead.
  site_id uuid not null references public.sites (id) on delete restrict,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.shift_status not null default 'scheduled',
  notes text check (char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  -- An officer can't be booked for two shifts at the same time
  -- (cancelled shifts don't count).
  constraint shifts_no_overlap exclude using gist (
    officer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled')
);

create index shifts_officer_starts_idx on public.shifts (officer_id, starts_at);
create index shifts_site_starts_idx on public.shifts (site_id, starts_at);
-- For the missed-shift job.
create index shifts_open_starts_idx on public.shifts (starts_at)
  where status in ('scheduled', 'acknowledged');

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

create trigger shifts_guard_admin_only_columns
  before update on public.shifts
  for each row execute function public.guard_admin_only_columns('id', 'created_by', 'created_at');

-- Record who created the shift (can't be spoofed by the client), and require
-- the officer to be assigned to the site: otherwise RLS would hide the site's
-- address and emergency instructions from them.
create function public.shifts_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_user in ('anon', 'authenticated') then
    new.created_by := auth.uid();
  end if;

  if (tg_op = 'INSERT'
      or new.site_id is distinct from old.site_id
      or new.officer_id is distinct from old.officer_id)
     and not exists (
       select 1 from public.site_assignments sa
        where sa.site_id = new.site_id and sa.officer_id = new.officer_id
     )
  then
    raise exception 'The officer must be assigned to this site before they can be scheduled there'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger shifts_before_write
  before insert or update on public.shifts
  for each row execute function public.shifts_before_write();

-- ---------------------------------------------------------------------------
-- attendance_events
-- ---------------------------------------------------------------------------

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete restrict,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  type public.attendance_type not null,
  recorded_at timestamptz not null default now(), -- server time: the one that counts
  device_time timestamptz, -- the phone's clock, for reference only
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m >= 0),
  distance_from_site_m numeric(10, 1) check (distance_from_site_m >= 0),
  is_mock_location boolean not null default false,
  device_id text not null check (char_length(device_id) between 1 and 200),
  flags text[] not null default '{}' check (
    flags <@ array['late', 'early_leave', 'out_of_range', 'mock_location', 'low_accuracy', 'wrong_device']
  ),
  -- false: the attempt was refused (from a phone that isn't the officer's
  -- registered device). Kept so supervisors can see it; it doesn't count as a
  -- clock-in/out and doesn't change the shift.
  accepted boolean not null default true
);

comment on table public.attendance_events is
  'Append-only clock-in/out records. Written only by clock_event(). recorded_at is server time.';

create index attendance_events_shift_idx on public.attendance_events (shift_id, type);
create index attendance_events_officer_idx on public.attendance_events (officer_id, recorded_at desc);

-- One accepted clock-in and one accepted clock-out per shift, even under
-- concurrent requests.
create unique index attendance_events_one_per_type
  on public.attendance_events (shift_id, type)
  where accepted;

-- ---------------------------------------------------------------------------
-- Distance (no PostGIS needed): great-circle distance in metres.
-- ---------------------------------------------------------------------------

create function public.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

comment on function public.distance_m is 'Haversine distance in metres between two lat/lng points.';

-- ---------------------------------------------------------------------------
-- clock_event: the only way to clock in or out
-- ---------------------------------------------------------------------------

create function public.clock_event(
  p_shift_id uuid,
  p_type public.attendance_type,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_is_mock_location boolean,
  p_device_id text,
  p_device_time timestamptz default null
)
returns public.attendance_events
language plpgsql
security definer -- writes attendance and shift status, which officers can't do directly
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now(); -- server time; the phone's clock is never trusted
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
      coalesce(p_is_mock_location, false), p_device_id, array['wrong_device'], false
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
    if v_now < v_shift.starts_at - make_interval(mins => v_settings.early_clock_in_minutes) then
      raise exception 'Too early to clock in: you can clock in % minutes before the shift starts',
        v_settings.early_clock_in_minutes using errcode = 'P0001';
    end if;
    if v_now >= v_shift.ends_at then
      raise exception 'This shift has already ended' using errcode = 'P0001';
    end if;
    if v_now > v_shift.starts_at + make_interval(mins => v_settings.late_grace_minutes) then
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
    if v_now < v_shift.ends_at then
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
  'Clock in/out for the caller''s own shift from their registered device. Server time; flags exceptions.';

revoke execute on function public.clock_event from public, anon;
grant execute on function public.clock_event to authenticated;

-- ---------------------------------------------------------------------------
-- Missed shifts: every 5 minutes (pg_cron)
-- ---------------------------------------------------------------------------

create function public.mark_missed_shifts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grace integer;
  v_count integer;
begin
  select late_grace_minutes into v_grace from public.settings where id;

  update public.shifts s
     set status = 'missed'
   where s.status in ('scheduled', 'acknowledged')
     and s.starts_at + make_interval(mins => v_grace) < now()
     and not exists (
       select 1 from public.attendance_events e
        where e.shift_id = s.id and e.type = 'clock_in' and e.accepted
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_missed_shifts is
  'Marks shifts missed when nobody clocked in by starts_at + late grace. Run by pg_cron.';

revoke execute on function public.mark_missed_shifts from public, anon, authenticated;

select cron.schedule(
  'mark-missed-shifts',
  '*/5 * * * *',
  'select public.mark_missed_shifts()'
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.settings enable row level security;
alter table public.shifts enable row level security;
alter table public.attendance_events enable row level security;

revoke all on public.settings, public.shifts, public.attendance_events from anon, authenticated;
grant select, update on public.settings to authenticated;
grant select, insert, update, delete on public.shifts to authenticated;
-- Read-only through the API: attendance is written only by clock_event().
grant select on public.attendance_events to authenticated;
grant all on public.settings, public.shifts, public.attendance_events to service_role;

-- settings ----------------------------------------------------------------

create policy "settings: active users read"
  on public.settings for select to authenticated
  using ((select public.is_active_user()));

create policy "settings: admins update"
  on public.settings for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- shifts ------------------------------------------------------------------

create policy "shifts: officers read their own"
  on public.shifts for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "shifts: staff read all"
  on public.shifts for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "shifts: staff create"
  on public.shifts for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "shifts: staff update"
  on public.shifts for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'))
  with check ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "shifts: admins delete"
  on public.shifts for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- attendance_events (no insert/update/delete policies: nobody writes directly)

create policy "attendance_events: officers read their own"
  on public.attendance_events for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "attendance_events: staff read all"
  on public.attendance_events for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));
