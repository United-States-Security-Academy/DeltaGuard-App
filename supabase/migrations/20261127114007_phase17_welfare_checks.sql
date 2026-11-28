-- Phase 17: welfare checks (lone-worker safety).
--
-- While an officer is clocked in, the phone asks "are you alert?" at random
-- times. A missed check escalates:
--
--   scheduled --(scheduled_at)--> prompted        push to the officer
--   prompted  --(response_seconds)--> alarm        loud push to the officer
--   alarm     --(alarm_seconds)--> calling         automated voice call 1
--   calling   --(call_gap_seconds)--> calling      call 2 .. call_attempts
--   calling   --(call_gap_seconds after the last call)--> escalated
--             push + SMS to on-duty supervisors and admins
--   escalated --(a supervisor, with notes)--> resolved
--
-- The officer can answer in prompted / alarm / calling (-> responded) and also
-- after escalation (recorded and logged, but a supervisor still closes it).
-- policy.supervisor_alert_after_seconds, when set, escalates no later than that
-- many seconds after the prompt, even if calls are still to come.
--
-- Scheduling: at clock-in (shift -> in_progress) the first check is created at
-- a random time within the policy interval (the night interval during night
-- hours, in settings.time_zone). Each answer or resolution creates the next one.
-- Only ever ONE check ahead: a unique index allows one open check per shift.
-- Clock-out (shift leaves in_progress) cancels open checks. No check is
-- scheduled at or after the shift's end.
--
-- Policies: sites.welfare_policy_id, else settings.welfare_policy_id (company
-- default). A disabled policy turns checks off for its sites. The seeded
-- "Standard" policy is NOT the company default, so nothing starts until an
-- admin chooses it (the phone app has no welfare screen yet).
--
-- Escalation runs in the database (welfare_run_escalation): pg_cron every
-- minute, so prompts and supervisor pushes never depend on an Edge Function.
-- Voice calls and SMS wait in welfare_outbox and are placed by the Edge
-- Function `welfare-escalation` (Twilio), which the job asks via pg_net.
-- Idempotent: rows are locked (skip locked) and moved one step at a time with
-- the step's due time; outbox rows are unique per (check, kind, phone, call
-- number); pushes use notify_users dedupe keys. A step can't be sent twice.
--
-- Location: none is collected for this feature. Escalation messages use the
-- clock-in location already recorded by clock_event (CLAUDE.md).

create type public.welfare_check_status as enum (
  'scheduled', 'prompted', 'responded', 'alarm', 'calling', 'escalated', 'resolved', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.welfare_check_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 100),
  -- A check comes a random time between min and max minutes after the last one.
  min_interval_minutes integer not null default 45 check (min_interval_minutes between 5 and 720),
  max_interval_minutes integer not null default 75 check (max_interval_minutes between 5 and 720),
  -- Night hours in the company time zone (may wrap midnight, e.g. 22:00-06:00).
  night_start time,
  night_end time,
  night_min_interval_minutes integer check (night_min_interval_minutes between 5 and 720),
  night_max_interval_minutes integer check (night_max_interval_minutes between 5 and 720),
  response_seconds integer not null default 60 check (response_seconds between 15 and 900),
  alarm_seconds integer not null default 60 check (alarm_seconds between 0 and 900),
  call_attempts integer not null default 2 check (call_attempts between 0 and 5),
  call_gap_seconds integer not null default 150 check (call_gap_seconds between 30 and 900),
  -- Optional cap: supervisors are alerted no later than this after the prompt.
  supervisor_alert_after_seconds integer
    check (supervisor_alert_after_seconds between 60 and 7200),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_interval_minutes >= min_interval_minutes),
  check ((night_start is null) = (night_end is null)),
  check (night_start is null or night_start <> night_end),
  check (
    night_start is null
    or (night_min_interval_minutes is not null and night_max_interval_minutes is not null
        and night_max_interval_minutes >= night_min_interval_minutes)
  )
);

comment on table public.welfare_check_policies is
  'Welfare check timing and escalation rules. Attached to sites (sites.welfare_policy_id) with a company default in settings. Admins manage.';

create trigger welfare_check_policies_set_updated_at
  before update on public.welfare_check_policies
  for each row execute function public.set_updated_at();

insert into public.welfare_check_policies (
  name, min_interval_minutes, max_interval_minutes, night_start, night_end,
  night_min_interval_minutes, night_max_interval_minutes
) values ('Standard', 45, 75, '22:00', '06:00', 30, 50);

alter table public.settings
  add column welfare_policy_id uuid references public.welfare_check_policies (id) on delete set null;
comment on column public.settings.welfare_policy_id is
  'Company default welfare check policy for sites without their own. Null: no checks.';

alter table public.sites
  add column welfare_policy_id uuid references public.welfare_check_policies (id) on delete set null;
comment on column public.sites.welfare_policy_id is
  'Welfare check policy for this site; null = the company default (settings.welfare_policy_id).';

-- Supervisors may edit site details, but not the site's safety policy.
create trigger sites_guard_welfare_policy
  before update on public.sites
  for each row execute function public.guard_admin_only_columns('welfare_policy_id');

create table public.welfare_checks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete restrict,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  policy_id uuid references public.welfare_check_policies (id) on delete set null,
  -- The policy's escalation timing when the check was made (later edits to the
  -- policy don't change a check already under way).
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  scheduled_at timestamptz not null,
  prompted_at timestamptz,
  responded_at timestamptz, -- server time; the phone's time (bounded) for offline answers
  responded_at_device timestamptz,
  response_seconds integer check (response_seconds >= 0),
  responded_offline boolean not null default false,
  biometric_verified boolean not null default false,
  device_id text check (char_length(device_id) between 1 and 200),
  response_flags text[] not null default '{}' check (
    response_flags <@ array['late', 'offline', 'after_escalation', 'unregistered_device']
  ),
  status public.welfare_check_status not null default 'scheduled',
  -- When the escalation job next acts on this check; null = nothing due.
  step_due_at timestamptz,
  calls_made integer not null default 0 check (calls_made >= 0),
  -- Staff alerted at escalation (they may read and resolve it).
  alerted_user_ids uuid[] not null default '{}',
  -- [{ "at": ..., "step": "prompted" | "alarm" | "call_queued" | "call_placed" | ..., ... }]
  escalation_log jsonb not null default '[]' check (jsonb_typeof(escalation_log) = 'array'),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolution_notes text check (char_length(resolution_notes) <= 2000),
  created_at timestamptz not null default now(),
  check (status <> 'resolved' or (resolved_at is not null and resolution_notes is not null))
);

comment on table public.welfare_checks is
  'Lone-worker welfare checks. Written only by the welfare functions (RPCs and the escalation job).';

-- Never more than one check ahead: one open check per shift.
create unique index welfare_checks_one_open_per_shift
  on public.welfare_checks (shift_id)
  where status in ('scheduled', 'prompted', 'alarm', 'calling');
create index welfare_checks_due_idx on public.welfare_checks (step_due_at)
  where step_due_at is not null;
create index welfare_checks_officer_idx on public.welfare_checks (officer_id, scheduled_at desc);
create index welfare_checks_site_idx on public.welfare_checks (site_id, scheduled_at desc);
create index welfare_checks_shift_idx on public.welfare_checks (shift_id);

create table public.device_heartbeats (
  -- Latest only: one row per officer, overwritten every few minutes on duty.
  officer_id uuid primary key references public.profiles (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 200),
  last_seen_at timestamptz not null default now(),
  battery_level integer check (battery_level between 0 and 100), -- percent
  app_state text not null default 'unknown'
    check (app_state in ('active', 'background', 'inactive', 'unknown')),
  shift_id uuid references public.shifts (id) on delete set null
);

comment on table public.device_heartbeats is
  'The officer''s phone checking in while on duty (no location). Written only by record_device_heartbeat().';

create table public.welfare_outbox (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.welfare_checks (id) on delete cascade,
  kind text not null check (kind in ('call', 'sms')),
  attempt_no integer not null default 1 check (attempt_no >= 1), -- call number
  recipient_id uuid references public.profiles (id) on delete set null,
  recipient_name text,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  body text not null check (char_length(body) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (check_id, kind, phone, attempt_no)
);

comment on table public.welfare_outbox is
  'Voice calls and SMS for welfare escalation, placed by the welfare-escalation Edge Function.';

create index welfare_outbox_due_idx on public.welfare_outbox (next_attempt_at)
  where status in ('pending', 'failed', 'sending');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** Appends one entry to a check's escalation log. */
create function public.welfare_log(p_check_id uuid, p_step text, p_at timestamptz, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  update public.welfare_checks
     set escalation_log = escalation_log
       || jsonb_build_array(jsonb_build_object('at', p_at, 'step', p_step) || coalesce(p_data, '{}'))
   where id = p_check_id
$$;

/** The enabled policy for a site (its own, else the company default), or null. */
create function public.welfare_policy_for_site(p_site_id uuid)
returns public.welfare_check_policies
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.welfare_check_policies p
   where p.id = coalesce(
           (select s.welfare_policy_id from public.sites s where s.id = p_site_id),
           (select st.welfare_policy_id from public.settings st where st.id)
         )
     and p.enabled
$$;

/** Whether p_at falls in the policy's night hours (company time zone). */
create function public.welfare_is_night(p_policy public.welfare_check_policies, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_policy.night_start is null then false
    else (
      with t as (
        select (p_at at time zone coalesce(
                  (select time_zone from public.settings where id), 'UTC'))::time as local
      )
      select case
        when p_policy.night_start < p_policy.night_end
          then t.local >= p_policy.night_start and t.local < p_policy.night_end
        else t.local >= p_policy.night_start or t.local < p_policy.night_end -- wraps midnight
      end
      from t
    )
  end
$$;

/** The interval (minutes) to use at p_at: [min, max], night or day. */
create function public.welfare_interval_minutes(p_policy_id uuid, p_at timestamptz)
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.welfare_is_night(p, p_at)
              then array[p.night_min_interval_minutes, p.night_max_interval_minutes]
              else array[p.min_interval_minutes, p.max_interval_minutes] end
    from public.welfare_check_policies p where p.id = p_policy_id
$$;

/**
 * Creates the next check for a shift that is in progress, at a random time
 * within the policy interval after p_from. Does nothing (returns null) if the
 * shift isn't in progress, has no enabled policy, already has an open check,
 * or would end first.
 */
create function public.welfare_schedule_next(p_shift_id uuid, p_from timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_policy public.welfare_check_policies;
  v_range integer[];
  v_at timestamptz;
  v_id uuid;
begin
  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.id is null or v_shift.status <> 'in_progress' then
    return null;
  end if;
  v_policy := public.welfare_policy_for_site(v_shift.site_id);
  if v_policy.id is null then
    return null;
  end if;

  v_range := public.welfare_interval_minutes(v_policy.id, p_from);
  v_at := p_from + make_interval(secs => v_range[1] * 60
            + floor(random() * ((v_range[2] - v_range[1]) * 60 + 1)));
  if v_at >= v_shift.ends_at then
    return null;
  end if;

  insert into public.welfare_checks (
    shift_id, officer_id, site_id, policy_id, policy, scheduled_at, step_due_at, escalation_log
  ) values (
    v_shift.id, v_shift.officer_id, v_shift.site_id, v_policy.id,
    jsonb_build_object(
      'name', v_policy.name,
      'interval_minutes', to_jsonb(v_range),
      'night', public.welfare_is_night(v_policy, p_from),
      'response_seconds', v_policy.response_seconds,
      'alarm_seconds', v_policy.alarm_seconds,
      'call_attempts', v_policy.call_attempts,
      'call_gap_seconds', v_policy.call_gap_seconds,
      'supervisor_alert_after_seconds', v_policy.supervisor_alert_after_seconds
    ),
    v_at, v_at,
    jsonb_build_array(jsonb_build_object('at', now(), 'step', 'scheduled', 'scheduled_at', v_at))
  )
  on conflict (shift_id) where status in ('scheduled', 'prompted', 'alarm', 'calling') do nothing
  returning id into v_id;
  return v_id;
end;
$$;

/** Clock-in starts the checks; leaving in_progress (clock-out, etc.) cancels them. */
create function public.welfare_on_shift_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    perform public.welfare_schedule_next(new.id, now());
  elsif old.status = 'in_progress' and new.status <> 'in_progress' then
    for v_id in
      update public.welfare_checks
         set status = 'cancelled', step_due_at = null
       where shift_id = new.id and status in ('scheduled', 'prompted', 'alarm', 'calling')
      returning id
    loop
      perform public.welfare_log(v_id, 'cancelled', now(),
        jsonb_build_object('reason', 'shift ' || new.status::text));
    end loop;
    -- Escalated checks stay open for a supervisor; note that the shift ended.
    for v_id in
      select id from public.welfare_checks where shift_id = new.id and status = 'escalated'
    loop
      perform public.welfare_log(v_id, 'shift_ended', now(),
        jsonb_build_object('shift_status', new.status));
    end loop;
  end if;
  return null;
end;
$$;

create trigger shifts_welfare_checks
  after update of status on public.shifts
  for each row execute function public.welfare_on_shift_status();

/** A supervisor assigned to this site (admins are handled separately). */
create function public.supervises_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_active_user()
    and public.auth_role() = 'supervisor'
    and exists (
      select 1 from public.site_assignments a
       where a.officer_id = auth.uid() and a.site_id = p_site_id
    ),
    false
  )
$$;

/** Staff who may read and resolve a check: admins, its site's supervisors, anyone alerted. */
create function public.can_manage_welfare_check(p_check_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_active_user() and (
      public.auth_role() = 'admin'
      or (public.auth_role() = 'supervisor' and exists (
            select 1 from public.welfare_checks c
             where c.id = p_check_id
               and (public.supervises_site(c.site_id) or auth.uid() = any (c.alerted_user_ids))
          ))
    ),
    false
  )
$$;

/** Asks the Edge Function to place queued calls / SMS (no-op if functions aren't configured). */
create function public.request_welfare_delivery()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'deltaguard_functions_url';
  if v_url is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/welfare-escalation',
    body := jsonb_build_object('action', 'deliver'),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'request_welfare_delivery: %', sqlerrm;
end;
$$;

/** Formats a time in the company time zone, e.g. "3:05 AM". */
create function public.welfare_local_time(p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(p_at at time zone coalesce((select time_zone from public.settings where id), 'UTC'),
                 'FMHH12:MI AM')
$$;

/** Moves a check to escalated: push + SMS to on-duty supervisors and admins. */
create function public.welfare_escalate(p_check public.welfare_checks, p_now timestamptz, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid[] := public.sos_staff_targets(p_check.officer_id);
  v_officer public.profiles;
  v_site_name text;
  v_beat public.device_heartbeats;
  v_in public.attendance_events;
  v_since timestamptz := coalesce(p_check.prompted_at, p_check.scheduled_at);
  v_text text;
  v_sms integer;
begin
  select * into v_officer from public.profiles where id = p_check.officer_id;
  select name into v_site_name from public.sites where id = p_check.site_id;
  select * into v_beat from public.device_heartbeats where officer_id = p_check.officer_id;
  select * into v_in from public.attendance_events e
   where e.shift_id = p_check.shift_id and e.type = 'clock_in' and e.accepted
   limit 1;

  v_text := left(
    'DELTACON WELFARE ALERT: ' || coalesce(nullif(btrim(v_officer.full_name), ''), 'An officer')
    || ' at ' || coalesce(v_site_name, 'an unknown site')
    || ' has not answered a welfare check since ' || public.welfare_local_time(v_since) || '. '
    || case
         when v_beat.officer_id is null then 'No phone heartbeat received. '
         else 'Phone last seen ' || public.welfare_local_time(v_beat.last_seen_at)
              || coalesce(', battery ' || v_beat.battery_level || '%', '')
              || ', app ' || v_beat.app_state || '. '
       end
    || case
         when v_in.id is null then ''
         else 'Clock-in location: https://maps.google.com/?q=' || v_in.latitude || ',' || v_in.longitude || ' '
       end
    || coalesce('Officer phone: ' || public.e164_or_null(v_officer.phone) || '.', ''),
    900
  );

  perform public.notify_users(
    v_staff, 'welfare_escalated',
    'Welfare check missed: ' || coalesce(nullif(btrim(v_officer.full_name), ''), 'officer'),
    coalesce(v_site_name, 'Unknown site') || ' · no answer since ' || public.welfare_local_time(v_since)
      || coalesce(' · battery ' || v_beat.battery_level || '%', ''),
    jsonb_build_object('check_id', p_check.id, 'officer_id', p_check.officer_id),
    'welfare:' || p_check.id || ':escalated'
  );

  with rows as (
    insert into public.welfare_outbox (check_id, kind, attempt_no, recipient_id, recipient_name, phone, body)
    select p_check.id, 'sms', 1, p.id, p.full_name, public.e164_or_null(p.phone), v_text
      from public.profiles p
     where p.id = any (v_staff) and public.e164_or_null(p.phone) is not null
    on conflict (check_id, kind, phone, attempt_no) do nothing
    returning 1
  )
  select count(*) into v_sms from rows;

  update public.welfare_checks
     set status = 'escalated', step_due_at = null, alerted_user_ids = v_staff
   where id = p_check.id;
  perform public.welfare_log(p_check.id, 'escalated', p_now, jsonb_build_object(
    'reason', p_reason,
    'push_user_ids', to_jsonb(v_staff),
    'sms_queued', v_sms,
    'without_sms_number', (select count(*) from public.profiles p
                            where p.id = any (v_staff) and public.e164_or_null(p.phone) is null),
    'last_heartbeat_at', v_beat.last_seen_at,
    'battery_level', v_beat.battery_level,
    'clock_in_location', case when v_in.id is not null
      then jsonb_build_object('latitude', v_in.latitude, 'longitude', v_in.longitude, 'accuracy_m', v_in.accuracy_m)
    end
  ));
  return v_sms;
end;
$$;

-- ---------------------------------------------------------------------------
-- The escalation job
-- ---------------------------------------------------------------------------

/**
 * Moves every due check one step. Safe to run any number of times and in
 * parallel: rows are locked and skipped if busy, and each step changes the
 * status / due time it was chosen by. p_now is for tests. p_request_delivery:
 * ask the Edge Function to place queued calls / SMS (the function itself
 * passes false). Returns how many checks moved.
 */
create function public.welfare_run_escalation(
  p_now timestamptz default null,
  p_request_delivery boolean default true
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_check public.welfare_checks;
  v_p jsonb;
  v_cap timestamptz;
  v_phone text;
  v_name text;
  v_shift_status public.shift_status;
  v_moved integer := 0;
  v_queued integer := 0;
  v_next integer;
begin
  for v_check in
    select * from public.welfare_checks c
     where c.status in ('scheduled', 'prompted', 'alarm', 'calling')
       and c.step_due_at <= v_now
     order by c.step_due_at
     for update skip locked
  loop
    v_p := v_check.policy;
    v_moved := v_moved + 1;

    -- Safety net: the shift is over (the trigger normally cancels first).
    select status into v_shift_status from public.shifts where id = v_check.shift_id;
    if v_shift_status is distinct from 'in_progress' then
      update public.welfare_checks set status = 'cancelled', step_due_at = null where id = v_check.id;
      perform public.welfare_log(v_check.id, 'cancelled', v_now,
        jsonb_build_object('reason', 'shift ' || coalesce(v_shift_status::text, 'missing')));
      continue;
    end if;

    -- Latest time supervisors must be alerted (optional policy cap).
    v_cap := case when v_p ->> 'supervisor_alert_after_seconds' is not null
                  then coalesce(v_check.prompted_at, v_now)
                       + make_interval(secs => (v_p ->> 'supervisor_alert_after_seconds')::int) end;

    if v_check.status in ('alarm', 'calling') and v_cap <= v_now then
      v_queued := v_queued + public.welfare_escalate(v_check, v_now, 'time_limit');

    elsif v_check.status = 'scheduled' then
      update public.welfare_checks
         set status = 'prompted', prompted_at = v_now,
             step_due_at = least(v_now + make_interval(secs => (v_p ->> 'response_seconds')::int),
                                 coalesce(v_now + make_interval(secs => (v_p ->> 'supervisor_alert_after_seconds')::int), 'infinity'))
       where id = v_check.id;
      perform public.notify_users(
        array[v_check.officer_id], 'welfare_check', 'Welfare check',
        'Open DeltaGuard and confirm you are alert.',
        jsonb_build_object('check_id', v_check.id), 'welfare:' || v_check.id || ':prompt'
      );
      perform public.welfare_log(v_check.id, 'prompted', v_now);

    elsif v_check.status = 'prompted' then
      if v_cap <= v_now then
        v_queued := v_queued + public.welfare_escalate(v_check, v_now, 'time_limit');
      else
        update public.welfare_checks
           set status = 'alarm',
               step_due_at = least(v_now + make_interval(secs => (v_p ->> 'alarm_seconds')::int),
                                   coalesce(v_cap, 'infinity'))
         where id = v_check.id;
        perform public.notify_users(
          array[v_check.officer_id], 'welfare_alarm', 'Welfare check: answer now',
          'You missed a welfare check. Open DeltaGuard and confirm you are alert, or your supervisor will be called.',
          jsonb_build_object('check_id', v_check.id), 'welfare:' || v_check.id || ':alarm'
        );
        perform public.welfare_log(v_check.id, 'alarm', v_now);
      end if;

    elsif v_check.calls_made < (v_p ->> 'call_attempts')::int then
      -- alarm -> calling (call 1), or the next call.
      v_next := v_check.calls_made + 1;
      select public.e164_or_null(p.phone), p.full_name into v_phone, v_name
        from public.profiles p where p.id = v_check.officer_id;
      update public.welfare_checks
         set status = 'calling', calls_made = v_next,
             step_due_at = least(v_now + make_interval(secs => (v_p ->> 'call_gap_seconds')::int),
                                 coalesce(v_cap, 'infinity'))
       where id = v_check.id;
      if v_phone is not null then
        insert into public.welfare_outbox (check_id, kind, attempt_no, recipient_id, recipient_name, phone, body)
        values (v_check.id, 'call', v_next, v_check.officer_id, v_name, v_phone,
                'Deltacon welfare check, please open the app and confirm you are alert.')
        on conflict (check_id, kind, phone, attempt_no) do nothing;
        v_queued := v_queued + 1;
        perform public.welfare_log(v_check.id, 'call_queued', v_now, jsonb_build_object('call', v_next));
      else
        perform public.welfare_log(v_check.id, 'call_skipped', v_now,
          jsonb_build_object('call', v_next, 'reason', 'no phone number on the officer''s profile'));
      end if;

    else
      -- Every call made (or none configured) and the gap has passed.
      v_queued := v_queued + public.welfare_escalate(v_check, v_now,
        case when (v_p ->> 'call_attempts')::int = 0 then 'no_answer' else 'no_answer_after_calls' end);
    end if;
  end loop;

  if p_request_delivery and (v_queued > 0 or exists (
    select 1 from public.welfare_outbox o
     where (o.status in ('pending', 'failed') and o.next_attempt_at <= now()
            and o.attempts < case when o.kind = 'call' then 2 else 5 end)
        or (o.status = 'sending' and o.claimed_at < now() - interval '2 minutes')
  )) then
    perform public.request_welfare_delivery();
  end if;
  return v_moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Outbox (Edge Function, service role)
-- ---------------------------------------------------------------------------

/**
 * Claims calls / SMS due for sending. Rows that no longer make sense are
 * skipped and logged first: a call once the check has been answered or left
 * the calling step, an SMS once the check is resolved or cancelled.
 */
create function public.claim_welfare_outbox(p_limit integer default 50)
returns setof public.welfare_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in
    update public.welfare_outbox o
       set status = 'skipped', error = 'No longer needed: the check is ' || c.status::text
      from public.welfare_checks c
     where c.id = o.check_id
       and o.status in ('pending', 'failed', 'sending')
       and ((o.kind = 'call' and (c.status <> 'calling' or c.responded_at is not null))
            or (o.kind = 'sms' and c.status in ('resolved', 'cancelled')))
    returning o.check_id, o.kind, o.attempt_no, o.recipient_name, c.status
  loop
    perform public.welfare_log(v_row.check_id, v_row.kind || '_skipped', now(), jsonb_build_object(
      'to', v_row.recipient_name, 'call', case when v_row.kind = 'call' then v_row.attempt_no end,
      'reason', 'check ' || v_row.status::text));
  end loop;

  return query
  update public.welfare_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select x.id from public.welfare_outbox x
      where (x.status in ('pending', 'failed') and x.next_attempt_at <= now()
             and x.attempts < case when x.kind = 'call' then 2 else 5 end)
         or (x.status = 'sending' and x.claimed_at < now() - interval '2 minutes')
      order by x.created_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked
   )
  returning o.*;
end;
$$;

/** Records how a claimed call / SMS went, and logs it on the check. */
create function public.finish_welfare_outbox(
  p_id uuid,
  p_status text,
  p_provider_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.welfare_outbox;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  update public.welfare_outbox
     set status = p_status,
         provider_id = coalesce(p_provider_id, provider_id),
         error = left(p_error, 500),
         sent_at = case when p_status = 'sent' then now() end,
         next_attempt_at = now() + (interval '15 seconds' * power(2, greatest(attempts - 1, 0)))
   where id = p_id
  returning * into v_row;
  if v_row.id is null then
    return;
  end if;
  perform public.welfare_log(
    v_row.check_id,
    case when v_row.kind = 'call' then
           case p_status when 'sent' then 'call_placed' else 'call_' || p_status end
         else 'sms_' || p_status end,
    now(),
    jsonb_build_object(
      'to', v_row.recipient_name,
      'call', case when v_row.kind = 'call' then v_row.attempt_no end,
      'attempt', v_row.attempts,
      'provider_id', p_provider_id,
      'error', left(p_error, 500)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The officer's side
-- ---------------------------------------------------------------------------

/**
 * The caller's next (or current, unanswered) check on their shift in progress:
 * only its id and time. Later checks don't exist yet.
 */
create function public.get_next_welfare_check()
returns table (id uuid, scheduled_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.scheduled_at
    from public.welfare_checks c
    join public.shifts s on s.id = c.shift_id
   where public.is_active_user()
     and c.officer_id = auth.uid()
     and s.status = 'in_progress'
     and (c.status in ('scheduled', 'prompted', 'alarm', 'calling')
          or (c.status = 'escalated' and c.responded_at is null))
   order by c.scheduled_at
   limit 1
$$;

/**
 * The officer answers a check. Online: server time counts. Offline (sent later
 * from the phone's queue): the phone's time counts, bounded to [scheduled_at,
 * now], and the answer is flagged `offline`. Answers slower than the policy's
 * response_seconds are flagged `late`. Repeating an answer changes nothing.
 * Returns the check's outcome and the next check (id and time).
 */
create function public.respond_welfare_check(
  p_check_id uuid,
  p_responded_at_device timestamptz,
  p_biometric_verified boolean,
  p_offline boolean,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_check public.welfare_checks;
  v_at timestamptz := now();
  v_seconds integer;
  v_flags text[] := '{}';
  v_was public.welfare_check_status;
  v_name text;
  v_next record;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_check from public.welfare_checks where id = p_check_id for update;
  if v_check.id is null or v_check.officer_id <> v_uid then
    raise exception 'Welfare check not found' using errcode = '42501';
  end if;

  if v_check.responded_at is null and v_check.status not in ('cancelled', 'resolved') then
    if v_check.status = 'scheduled' and v_check.scheduled_at > now() + interval '2 minutes' then
      raise exception 'This welfare check isn''t due yet' using errcode = 'P0001';
    end if;
    if p_device_id is not null and char_length(p_device_id) not between 1 and 200 then
      raise exception 'Invalid device' using errcode = '22023';
    end if;

    if coalesce(p_offline, false) then
      if p_responded_at_device is null then
        raise exception 'An offline answer needs the time it was given' using errcode = '22023';
      end if;
      if p_responded_at_device > now() + interval '5 minutes' then
        raise exception 'The time on this phone is wrong. Set it to automatic and try again'
          using errcode = '22023';
      end if;
      v_at := least(greatest(p_responded_at_device, v_check.scheduled_at), now());
      v_flags := array_append(v_flags, 'offline');
    end if;

    v_seconds := greatest(0, floor(extract(epoch from (
      v_at - least(coalesce(v_check.prompted_at, v_check.scheduled_at), v_at)))))::int;
    if v_seconds > (v_check.policy ->> 'response_seconds')::int then
      v_flags := array_append(v_flags, 'late');
    end if;
    if v_check.status = 'escalated' then
      v_flags := array_append(v_flags, 'after_escalation');
    end if;
    if p_device_id is null or not exists (
      select 1 from public.user_devices d
       where d.user_id = v_uid and d.device_id = p_device_id and d.revoked_at is null
    ) then
      v_flags := array_append(v_flags, 'unregistered_device');
    end if;

    v_was := v_check.status;
    update public.welfare_checks
       set responded_at = v_at,
           responded_at_device = p_responded_at_device,
           response_seconds = v_seconds,
           responded_offline = coalesce(p_offline, false),
           biometric_verified = coalesce(p_biometric_verified, false),
           device_id = p_device_id,
           response_flags = v_flags,
           -- An escalated check stays open until a supervisor closes it.
           status = case when v_was = 'escalated' then 'escalated'::public.welfare_check_status
                         else 'responded' end,
           step_due_at = null
     where id = p_check_id
    returning * into v_check;

    perform public.welfare_log(p_check_id, 'responded', now(), jsonb_build_object(
      'responded_at', v_at, 'response_seconds', v_seconds, 'flags', to_jsonb(v_flags),
      'biometric_verified', coalesce(p_biometric_verified, false), 'previous_status', v_was
    ));

    if v_was = 'escalated' then
      select coalesce(nullif(btrim(full_name), ''), 'The officer') into v_name
        from public.profiles where id = v_uid;
      perform public.notify_users(
        v_check.alerted_user_ids, 'welfare_update', v_name || ' answered the welfare check',
        'Answered at ' || public.welfare_local_time(v_at) || '. Close the alert with a note.',
        jsonb_build_object('check_id', p_check_id), 'welfare:' || p_check_id || ':answered'
      );
    end if;

    perform public.welfare_schedule_next(v_check.shift_id, now());
  end if;

  select n.id, n.scheduled_at into v_next from public.get_next_welfare_check() n;
  return jsonb_build_object(
    'id', v_check.id,
    'status', v_check.status,
    'responded_at', v_check.responded_at,
    'response_seconds', v_check.response_seconds,
    'response_flags', to_jsonb(v_check.response_flags),
    'next_check', case when v_next.id is not null
      then jsonb_build_object('id', v_next.id, 'scheduled_at', v_next.scheduled_at) end
  );
end;
$$;

/**
 * The phone checking in while on duty: battery and app state, no location.
 * Only from the officer's registered phone while a shift is in progress
 * (returns false otherwise, storing nothing).
 */
create function public.record_device_heartbeat(
  p_device_id text,
  p_battery_level integer default null,
  p_app_state text default 'unknown'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_shift_id uuid;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_battery_level is not null and p_battery_level not between 0 and 100 then
    raise exception 'Battery level is a percentage' using errcode = '22023';
  end if;
  if coalesce(p_app_state, 'unknown') not in ('active', 'background', 'inactive', 'unknown') then
    raise exception 'Unknown app state' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_devices d
     where d.user_id = v_uid and d.device_id = p_device_id and d.revoked_at is null
  ) then
    return false;
  end if;
  select s.id into v_shift_id from public.shifts s
   where s.officer_id = v_uid and s.status = 'in_progress'
   order by s.starts_at desc limit 1;
  if v_shift_id is null then
    return false;
  end if;

  insert into public.device_heartbeats (officer_id, device_id, last_seen_at, battery_level, app_state, shift_id)
  values (v_uid, p_device_id, now(), p_battery_level, coalesce(p_app_state, 'unknown'), v_shift_id)
  on conflict (officer_id) do update
    set device_id = excluded.device_id, last_seen_at = excluded.last_seen_at,
        battery_level = excluded.battery_level, app_state = excluded.app_state,
        shift_id = excluded.shift_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The staff's side
-- ---------------------------------------------------------------------------

/**
 * Closes a check that is under way or escalated, with notes (e.g. "Officer was
 * asleep", "Phone battery died", "Officer unwell, relief sent"). Stops any
 * further steps; if the shift is still in progress, the next check is made.
 */
create function public.resolve_welfare_check(p_check_id uuid, p_notes text)
returns public.welfare_checks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.welfare_checks;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_name text;
begin
  if not public.can_manage_welfare_check(p_check_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_notes is null then
    raise exception 'Add a note: what happened and what was done' using errcode = '22023';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'The note is too long (2000 characters at most)' using errcode = '22023';
  end if;
  select * into v_check from public.welfare_checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'Welfare check not found' using errcode = 'P0002';
  end if;
  if v_check.status not in ('prompted', 'alarm', 'calling', 'escalated') then
    raise exception 'Only a check that is under way or escalated can be resolved' using errcode = 'P0001';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'A supervisor') into v_name
    from public.profiles where id = auth.uid();

  update public.welfare_checks
     set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
         resolution_notes = v_notes, step_due_at = null
   where id = p_check_id
  returning * into v_check;
  perform public.welfare_log(p_check_id, 'resolved', now(),
    jsonb_build_object('by', v_name, 'by_id', auth.uid(), 'notes', v_notes));

  perform public.notify_users(
    array(select u from unnest(v_check.alerted_user_ids) u where u <> auth.uid()),
    'welfare_update', 'Welfare alert resolved',
    v_name || ': ' || v_notes,
    jsonb_build_object('check_id', p_check_id), 'welfare:' || p_check_id || ':resolved'
  );

  perform public.welfare_schedule_next(v_check.shift_id, now());
  return v_check;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.welfare_check_policies enable row level security;
alter table public.welfare_checks enable row level security;
alter table public.device_heartbeats enable row level security;
alter table public.welfare_outbox enable row level security;

create policy "welfare_check_policies: staff read"
  on public.welfare_check_policies for select to authenticated
  using ((select public.is_staff()));

create policy "welfare_check_policies: admins insert"
  on public.welfare_check_policies for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "welfare_check_policies: admins update"
  on public.welfare_check_policies for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "welfare_check_policies: admins delete"
  on public.welfare_check_policies for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- Officers: their own checks that have come due. The next one's time is
-- available only through get_next_welfare_check().
create policy "welfare_checks: officers read their own past checks"
  on public.welfare_checks for select to authenticated
  using ((select public.is_active_user())
         and officer_id = (select auth.uid())
         and scheduled_at <= now());

create policy "welfare_checks: admins read"
  on public.welfare_checks for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "welfare_checks: supervisors read for their sites"
  on public.welfare_checks for select to authenticated
  using ((select public.is_active_user())
         and (select public.auth_role()) = 'supervisor'
         and (public.supervises_site(site_id) or (select auth.uid()) = any (alerted_user_ids)));

create policy "device_heartbeats: officers read their own"
  on public.device_heartbeats for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "device_heartbeats: staff read"
  on public.device_heartbeats for select to authenticated
  using ((select public.is_active_user()) and (
    (select public.auth_role()) = 'admin' or public.supervises_officer(officer_id)
  ));

create policy "welfare_outbox: staff read for checks they manage"
  on public.welfare_outbox for select to authenticated
  using (public.can_manage_welfare_check(check_id));

-- Explicit grants (this project doesn't grant new tables automatically).
grant select on public.welfare_checks, public.device_heartbeats, public.welfare_outbox to authenticated;
grant select, insert, update, delete on public.welfare_check_policies to authenticated;
grant all on public.welfare_check_policies, public.welfare_checks, public.device_heartbeats,
  public.welfare_outbox to service_role;

revoke execute on function public.welfare_log from public, anon, authenticated;
revoke execute on function public.welfare_policy_for_site from public, anon, authenticated;
revoke execute on function public.welfare_is_night from public, anon, authenticated;
revoke execute on function public.welfare_interval_minutes from public, anon, authenticated;
revoke execute on function public.welfare_schedule_next from public, anon, authenticated;
revoke execute on function public.welfare_on_shift_status from public, anon, authenticated;
revoke execute on function public.request_welfare_delivery from public, anon, authenticated;
revoke execute on function public.welfare_local_time from public, anon, authenticated;
revoke execute on function public.welfare_escalate from public, anon, authenticated;
revoke execute on function public.welfare_run_escalation from public, anon, authenticated;
revoke execute on function public.claim_welfare_outbox from public, anon, authenticated;
revoke execute on function public.finish_welfare_outbox from public, anon, authenticated;
grant execute on function public.welfare_run_escalation to service_role;
grant execute on function public.claim_welfare_outbox to service_role;
grant execute on function public.finish_welfare_outbox to service_role;

revoke execute on function public.supervises_site from public, anon;
revoke execute on function public.can_manage_welfare_check from public, anon;
revoke execute on function public.get_next_welfare_check from public, anon;
revoke execute on function public.respond_welfare_check from public, anon;
revoke execute on function public.record_device_heartbeat from public, anon;
revoke execute on function public.resolve_welfare_check from public, anon;
grant execute on function public.supervises_site to authenticated;
grant execute on function public.can_manage_welfare_check to authenticated;
grant execute on function public.get_next_welfare_check to authenticated;
grant execute on function public.respond_welfare_check to authenticated;
grant execute on function public.record_device_heartbeat to authenticated;
grant execute on function public.resolve_welfare_check to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime and schedule
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.welfare_checks;

select cron.schedule('welfare-escalation', '* * * * *', 'select public.welfare_run_escalation()');
