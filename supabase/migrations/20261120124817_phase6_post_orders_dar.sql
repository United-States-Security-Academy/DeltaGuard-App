-- Phase 6: post orders (site instructions officers must acknowledge) and
-- daily activity reports (the officer's log for a shift), with handover notes.
--
-- post_orders                  one per topic per site; holds the current version
-- post_order_versions          every published version (history), written by trigger
-- post_order_acknowledgements  who acknowledged which version, written only by
--                              acknowledge_post_order()
-- daily_activity_reports       one per shift, created by clock_event() at clock-in
-- dar_entries                  timestamped log lines (patrol, visitor, handover…),
--                              optional photo in the private `dar-photos` bucket
--
-- Publishing: there are no drafts. Creating a post order publishes version 1;
-- any change to its title or body publishes the next version, which every
-- officer at the site must acknowledge again before they can clock in there.
--
-- Clock-in gate: clock_event() refuses a live clock-in while the officer has
-- not acknowledged the current version of every active post order at the
-- site (errcode DG001, so the app can open the post orders). A clock-in made
-- offline and sent later is never refused for this (the officer could not
-- read new orders without a connection); it is accepted and flagged
-- `post_orders_unread` for the supervisor instead.
--
-- Handover: clock_event(p_handover_note) saves the note as a `handover` entry
-- in the officer's report, in the same transaction as the clock-out, so it
-- also works through the offline queue. shift_handover() shows the latest
-- handover notes at a site to the officer of the next shift there (officers
-- can't otherwise read each other's reports).
--
-- Access summary (every policy also requires is_active_user()):
--   admin       post orders: full access; reads all reports; deletes entries
--   supervisor  post orders: create, edit, retire; reads all reports
--   officer     reads active post orders of their assigned sites and their own
--               acknowledgements; acknowledges through acknowledge_post_order();
--               reads their own reports; adds entries to them (append-only)

-- ---------------------------------------------------------------------------
-- post_orders
-- ---------------------------------------------------------------------------

create table public.post_orders (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 20000), -- Markdown
  -- Current version. Set by trigger: 1 on create, +1 on every title/body change.
  version integer not null default 1 check (version >= 1),
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  -- Retired: hidden from officers and no longer required at clock-in.
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.post_orders is
  'Site instructions (Markdown). Editing title/body publishes a new version that officers must acknowledge again.';

create index post_orders_site_idx on public.post_orders (site_id) where archived_at is null;

create trigger post_orders_set_updated_at
  before update on public.post_orders
  for each row execute function public.set_updated_at();

-- Version, publish stamp and authorship can't be set by the client.
create function public.post_orders_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.version := 1;
    new.published_at := now();
    new.published_by := auth.uid();
    new.created_by := auth.uid();
    new.created_at := now();
    new.archived_at := null;
    return new;
  end if;

  if new.site_id is distinct from old.site_id then
    raise exception 'A post order can''t be moved to another site' using errcode = '42501';
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if new.title is distinct from old.title or new.body is distinct from old.body then
    new.version := old.version + 1;
    new.published_at := now();
    new.published_by := auth.uid();
  else
    new.version := old.version;
    new.published_at := old.published_at;
    new.published_by := old.published_by;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    new.archived_at := now();
  elsif new.archived_at is not null then
    new.archived_at := old.archived_at;
  end if;

  return new;
end;
$$;

create trigger post_orders_before_write
  before insert or update on public.post_orders
  for each row execute function public.post_orders_before_write();

-- ---------------------------------------------------------------------------
-- post_order_versions (history)
-- ---------------------------------------------------------------------------

create table public.post_order_versions (
  post_order_id uuid not null references public.post_orders (id) on delete cascade,
  version integer not null check (version >= 1),
  title text not null,
  body text not null,
  published_at timestamptz not null,
  published_by uuid references public.profiles (id) on delete set null,
  primary key (post_order_id, version)
);

comment on table public.post_order_versions is
  'Every published version of a post order. Written only by trigger.';

create function public.post_orders_record_version()
returns trigger
language plpgsql
security definer -- clients have no write access to post_order_versions
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.post_order_versions (
      post_order_id, version, title, body, published_at, published_by
    ) values (
      new.id, new.version, new.title, new.body, new.published_at, new.published_by
    )
    on conflict (post_order_id, version) do update
      set title = excluded.title,
          body = excluded.body,
          published_at = excluded.published_at,
          published_by = excluded.published_by;
  end if;
  return null;
end;
$$;

create trigger post_orders_record_version
  after insert or update on public.post_orders
  for each row execute function public.post_orders_record_version();

-- ---------------------------------------------------------------------------
-- post_order_acknowledgements
-- ---------------------------------------------------------------------------

create table public.post_order_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  post_order_id uuid not null,
  version integer not null,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  acknowledged_at timestamptz not null default now(), -- server time
  -- restrict: a post order someone acknowledged is evidence; retire it instead.
  foreign key (post_order_id, version)
    references public.post_order_versions (post_order_id, version) on delete restrict,
  unique (post_order_id, version, officer_id)
);

comment on table public.post_order_acknowledgements is
  'Officer read-and-understood records per post order version. Written only by acknowledge_post_order().';

create index post_order_acks_officer_idx
  on public.post_order_acknowledgements (officer_id, post_order_id, version desc);

-- ---------------------------------------------------------------------------
-- acknowledge_post_order
-- ---------------------------------------------------------------------------

create function public.acknowledge_post_order(p_post_order_id uuid, p_version integer)
returns public.post_order_acknowledgements
language plpgsql
security definer -- officers have no write access to acknowledgements
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.post_orders;
  v_ack public.post_order_acknowledgements;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_order from public.post_orders where id = p_post_order_id;
  if not found or not exists (
    select 1 from public.site_assignments sa
     where sa.site_id = v_order.site_id and sa.officer_id = v_uid
  ) then
    raise exception 'Post order not found' using errcode = '42501';
  end if;
  if v_order.archived_at is not null then
    raise exception 'This post order has been withdrawn' using errcode = 'P0001';
  end if;
  -- The officer must have read what is current, not an older copy.
  if p_version is distinct from v_order.version then
    raise exception 'This post order has been updated. Read the new version and acknowledge it'
      using errcode = 'P0001';
  end if;

  insert into public.post_order_acknowledgements (post_order_id, version, officer_id)
  values (v_order.id, v_order.version, v_uid)
  on conflict (post_order_id, version, officer_id) do nothing
  returning * into v_ack;

  -- Already acknowledged (a double tap or a retry): return the original.
  if v_ack.id is null then
    select * into v_ack from public.post_order_acknowledgements
     where post_order_id = v_order.id and version = v_order.version and officer_id = v_uid;
  end if;

  return v_ack;
end;
$$;

comment on function public.acknowledge_post_order is
  'The caller acknowledges the current version of a post order at a site they are assigned to. Idempotent.';

revoke execute on function public.acknowledge_post_order from public, anon;
grant execute on function public.acknowledge_post_order to authenticated;

-- ---------------------------------------------------------------------------
-- post_orders_pending: how many post orders an officer still has to
-- acknowledge at a site, as of a given time (the version current then).
-- Internal: used by clock_event().
-- ---------------------------------------------------------------------------

create function public.post_orders_pending(
  p_site_id uuid,
  p_officer_id uuid,
  p_at timestamptz default now()
)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
    from public.post_orders po
    cross join lateral (
      select max(v.version) as required
        from public.post_order_versions v
       where v.post_order_id = po.id and v.published_at <= p_at
    ) req
   where po.site_id = p_site_id
     and po.archived_at is null
     and req.required is not null
     and not exists (
       select 1 from public.post_order_acknowledgements a
        where a.post_order_id = po.id
          and a.officer_id = p_officer_id
          and a.version >= req.required
     )
$$;

comment on function public.post_orders_pending is
  'Active post orders at a site whose version current at p_at the officer has not acknowledged.';

revoke execute on function public.post_orders_pending from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Daily activity reports
-- ---------------------------------------------------------------------------

create type public.dar_entry_type as enum ('patrol', 'observation', 'visitor', 'handover', 'other');

create table public.daily_activity_reports (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references public.shifts (id) on delete restrict,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.daily_activity_reports is
  'One per shift. Created by clock_event() at clock-in.';

create index daily_activity_reports_officer_idx
  on public.daily_activity_reports (officer_id, created_at desc);

create table public.dar_entries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_activity_reports (id) on delete cascade,
  -- Copied from the report by trigger (keeps RLS simple).
  officer_id uuid not null references public.profiles (id) on delete restrict,
  occurred_at timestamptz not null default now(),
  type public.dar_entry_type not null,
  description text not null check (char_length(btrim(description)) between 1 and 4000),
  -- Object path in the `dar-photos` bucket: <officer_id>/<report_id>/<file>
  photo_path text check (char_length(photo_path) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.dar_entries is
  'Lines of a daily activity report. Append-only for officers.';

create index dar_entries_report_idx on public.dar_entries (report_id, occurred_at);
create index dar_entries_handover_idx on public.dar_entries (occurred_at desc) where type = 'handover';

-- Owner, timing and photo path rules for entries written through the API.
create function public.dar_entries_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_report public.daily_activity_reports;
  v_shift public.shifts;
begin
  -- clock_event() (security definer) and the service role are trusted.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- RLS: officers only see their own reports.
  select * into v_report from public.daily_activity_reports where id = new.report_id;
  if not found then
    raise exception 'Report not found' using errcode = '42501';
  end if;
  new.officer_id := v_report.officer_id;
  new.created_at := now();
  new.occurred_at := coalesce(new.occurred_at, now());

  select * into v_shift from public.shifts where id = v_report.shift_id;
  if v_shift.status not in ('in_progress', 'completed')
     or (v_shift.status = 'completed' and now() > v_shift.ends_at + interval '12 hours')
  then
    raise exception 'This shift''s report is closed' using errcode = 'P0001';
  end if;

  if new.occurred_at > now() + interval '5 minutes' then
    raise exception 'The time of an entry can''t be in the future' using errcode = '22023';
  end if;
  if new.occurred_at < v_shift.starts_at - interval '2 hours' then
    raise exception 'The time of an entry must be during the shift' using errcode = '22023';
  end if;

  if new.photo_path is not null and (
    split_part(new.photo_path, '/', 1) <> new.officer_id::text
    or split_part(new.photo_path, '/', 2) <> new.report_id::text
    or split_part(new.photo_path, '/', 3) = ''
    or split_part(new.photo_path, '/', 4) <> ''
  ) then
    raise exception 'Invalid photo' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger dar_entries_before_insert
  before insert on public.dar_entries
  for each row execute function public.dar_entries_before_insert();

-- Shifts already clocked in before this migration get their report now.
insert into public.daily_activity_reports (shift_id, officer_id, created_at)
select e.shift_id, e.officer_id, min(e.recorded_at)
  from public.attendance_events e
 where e.accepted and e.type = 'clock_in'
 group by e.shift_id, e.officer_id
on conflict (shift_id) do nothing;

-- ---------------------------------------------------------------------------
-- shift_handover: the latest handover notes at the site of a shift
-- ---------------------------------------------------------------------------

create function public.shift_handover(p_shift_id uuid)
returns table (
  entry_id uuid,
  note text,
  noted_at timestamptz,
  officer_name text,
  from_shift_id uuid
)
language plpgsql
stable
security definer -- officers can't read each other's reports
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if not found or (
    v_shift.officer_id <> v_uid
    and public.auth_role() is distinct from 'admin'
    and public.auth_role() is distinct from 'supervisor'
  ) then
    raise exception 'Shift not found' using errcode = '42501';
  end if;

  -- Notes left at this site by other shifts, from a day before this shift
  -- starts until it ends.
  return query
    select e.id, e.description, e.occurred_at, p.full_name, r.shift_id
      from public.dar_entries e
      join public.daily_activity_reports r on r.id = e.report_id
      join public.shifts s on s.id = r.shift_id
      left join public.profiles p on p.id = e.officer_id
     where e.type = 'handover'
       and s.site_id = v_shift.site_id
       and r.shift_id <> v_shift.id
       and e.occurred_at >= v_shift.starts_at - interval '24 hours'
       and e.occurred_at <= least(now(), v_shift.ends_at)
     order by e.occurred_at desc
     limit 5;
end;
$$;

comment on function public.shift_handover is
  'Latest handover notes left at the site of the caller''s shift by other officers.';

revoke execute on function public.shift_handover from public, anon;
grant execute on function public.shift_handover to authenticated;

-- ---------------------------------------------------------------------------
-- 'post_orders_unread' attendance flag
-- ---------------------------------------------------------------------------

alter table public.attendance_events drop constraint attendance_events_flags_check;
alter table public.attendance_events add constraint attendance_events_flags_check check (
  flags <@ array[
    'late', 'early_leave', 'out_of_range', 'mock_location', 'low_accuracy', 'wrong_device',
    'delayed', 'post_orders_unread'
  ]
);

-- ---------------------------------------------------------------------------
-- clock_event: post order gate, DAR creation, handover note
-- ---------------------------------------------------------------------------

-- Adding a parameter would create an overload, so replace the function.
drop function public.clock_event(
  uuid, public.attendance_type, double precision, double precision, double precision, boolean,
  text, timestamptz, boolean
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
  'Clock in/out for the caller''s own shift from their registered device. Live clock-ins require acknowledged post orders (DG001). Queued events use the phone''s time (flagged delayed). Clock-out may leave a handover note.';

revoke execute on function public.clock_event from public, anon;
grant execute on function public.clock_event to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.post_orders enable row level security;
alter table public.post_order_versions enable row level security;
alter table public.post_order_acknowledgements enable row level security;
alter table public.daily_activity_reports enable row level security;
alter table public.dar_entries enable row level security;

revoke all on public.post_orders, public.post_order_versions, public.post_order_acknowledgements,
              public.daily_activity_reports, public.dar_entries
  from anon, authenticated;
grant select, insert, update, delete on public.post_orders to authenticated;
-- Written only by trigger / security definer functions.
grant select on public.post_order_versions, public.post_order_acknowledgements,
                public.daily_activity_reports
  to authenticated;
grant select, insert, delete on public.dar_entries to authenticated;
grant all on public.post_orders, public.post_order_versions, public.post_order_acknowledgements,
             public.daily_activity_reports, public.dar_entries
  to service_role;

-- post_orders ---------------------------------------------------------------

create policy "post_orders: officers read active orders of assigned sites"
  on public.post_orders for select to authenticated
  using (
    (select public.is_active_user())
    and archived_at is null
    and exists (
      select 1 from public.site_assignments sa
       where sa.site_id = post_orders.site_id
         and sa.officer_id = (select auth.uid())
    )
  );

create policy "post_orders: staff read all"
  on public.post_orders for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "post_orders: staff create"
  on public.post_orders for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "post_orders: staff update"
  on public.post_orders for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'))
  with check ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "post_orders: admins delete"
  on public.post_orders for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- post_order_versions -------------------------------------------------------

create policy "post_order_versions: staff read all"
  on public.post_order_versions for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

-- post_order_acknowledgements ----------------------------------------------

create policy "post_order_acknowledgements: officers read their own"
  on public.post_order_acknowledgements for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "post_order_acknowledgements: staff read all"
  on public.post_order_acknowledgements for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

-- daily_activity_reports ----------------------------------------------------

create policy "daily_activity_reports: officers read their own"
  on public.daily_activity_reports for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "daily_activity_reports: staff read all"
  on public.daily_activity_reports for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

-- dar_entries ---------------------------------------------------------------

create policy "dar_entries: officers read their own"
  on public.dar_entries for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "dar_entries: staff read all"
  on public.dar_entries for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

-- officer_id is copied from the report by the trigger, which runs first, so
-- this only passes for entries in the caller's own report.
create policy "dar_entries: officers add to their own report"
  on public.dar_entries for insert to authenticated
  with check ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "dar_entries: admins delete"
  on public.dar_entries for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Storage: private `dar-photos` bucket
-- Path convention: <officer_id>/<report_id>/<random name>.<ext>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dar-photos',
  'dar-photos',
  false,
  10 * 1024 * 1024, -- 10 MB
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp']
);

create policy "dar-photos: officers read their own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dar-photos'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "dar-photos: staff read all"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dar-photos'
    and (select public.is_active_user())
    and (select public.auth_role()) in ('admin', 'supervisor')
  );

create policy "dar-photos: officers upload to their own reports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dar-photos'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.daily_activity_reports r
       where r.id::text = (storage.foldername(name))[2]
         and r.officer_id = (select auth.uid())
    )
  );

create policy "dar-photos: admins delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'dar-photos'
    and (select public.is_active_user())
    and (select public.auth_role()) = 'admin'
  );
