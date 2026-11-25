-- Phase 12: SOS alerts.
--
-- sos_alerts      one per SOS; status active -> acknowledged -> resolved | false_alarm
-- sos_locations   the officer's position trail (at trigger, then every 30 s while
--                 the alert is open and the app is in the foreground)
-- sos_events      timestamped log of everything: trigger, each notification round,
--                 SMS results, acknowledgement, resolution, the officer's own actions
-- sos_contacts    ordered escalation list (admins manage), e.g. operations manager,
--                 owner, 24/7 monitoring centre
-- sos_sms_outbox  SMS queue, sent by the `sos-dispatch` Edge Function (Twilio)
--
-- Dispatch runs in the database (sos_run_dispatch), so it doesn't depend on the
-- Edge Function being reachable:
--   round 1 (immediately): push + SMS to on-duty supervisors (every active
--     supervisor if none is on duty) and every active admin;
--   then every 2 minutes while nobody has acknowledged: SMS (+ push if they have
--     an account) to the next sos_contacts entry, and the staff get the push
--     again. When the list runs out, staff keep getting a push every 2 minutes.
-- pg_cron runs sos_run_dispatch every 15 seconds; raise_sos runs it at once.
-- Push goes through notify_users (type 'sos'); SMS rows wait in the outbox and
-- the Edge Function is asked (pg_net) to send them, with retries.
--
-- Location: collected only at SOS time and while the alert is open, in the
-- foreground (CLAUDE.md). The phone chooses the alert id, so a retry after a
-- lost connection can't raise a second alert.

create type public.sos_status as enum ('active', 'acknowledged', 'resolved', 'false_alarm');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.sos_alerts (
  id uuid primary key, -- chosen by the phone
  officer_id uuid not null references public.profiles (id) on delete restrict,
  -- Copies taken when the alert is raised, so everyone who may see the alert can
  -- show them (officers and supervisors can't read every profile).
  officer_name text not null,
  officer_phone text,
  site_id uuid references public.sites (id) on delete set null,
  site_name text,
  shift_id uuid references public.shifts (id) on delete set null,
  -- Latest known position (null until the phone has one).
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m >= 0),
  location_at timestamptz,
  triggered_at timestamptz not null, -- the phone's time of the trigger
  created_at timestamptz not null default now(), -- when the server got it
  status public.sos_status not null default 'active',
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id) on delete set null,
  acknowledged_by_name text,
  acknowledge_notes text check (char_length(acknowledge_notes) <= 2000),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_by_name text,
  resolution_notes text check (char_length(resolution_notes) <= 2000),
  escalation_level integer not null default 0,
  next_escalation_at timestamptz, -- next notification round; null = none due
  check ((latitude is null) = (longitude is null))
);

comment on table public.sos_alerts is
  'SOS alerts. Written only by the SOS functions; the officer and staff read them.';

create index sos_alerts_open_idx on public.sos_alerts (next_escalation_at)
  where status in ('active', 'acknowledged');
create index sos_alerts_officer_idx on public.sos_alerts (officer_id, created_at desc);
create index sos_alerts_created_idx on public.sos_alerts (created_at desc);

create table public.sos_locations (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.sos_alerts (id) on delete cascade,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m >= 0),
  recorded_at timestamptz not null, -- the phone's time of the fix
  received_at timestamptz not null default now()
);

create index sos_locations_alert_idx on public.sos_locations (alert_id, recorded_at);

create table public.sos_events (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.sos_alerts (id) on delete cascade,
  type text not null check (type in (
    'triggered', 'notified', 'escalated', 'reminder', 'escalation_exhausted',
    'sms_sent', 'sms_failed', 'sms_skipped',
    'acknowledged', 'resolved', 'false_alarm', 'marked_safe',
    'officer_called_emergency', 'officer_called_supervisor', 'officer_sms_fallback'
  )),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  notes text check (char_length(notes) <= 2000),
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);

create index sos_events_alert_idx on public.sos_events (alert_id, created_at);

create table public.sos_contacts (
  id uuid primary key default gen_random_uuid(),
  position integer not null check (position between 1 and 100),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  -- E.164, e.g. +12145550123
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Optional: their account, so they also get the push.
  user_id uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sos_contacts is
  'Escalation list for unacknowledged SOS alerts, in position order. Admins manage it.';

create trigger sos_contacts_set_updated_at
  before update on public.sos_contacts
  for each row execute function public.set_updated_at();

create table public.sos_sms_outbox (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.sos_alerts (id) on delete cascade,
  recipient_name text,
  phone text not null,
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
  unique (alert_id, phone, body)
);

create index sos_sms_outbox_due_idx on public.sos_sms_outbox (next_attempt_at)
  where status in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** A phone number usable for SMS (E.164), or null. */
create function public.e164_or_null(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null then null
    when regexp_replace(p_phone, '[\s().-]', '', 'g') ~ '^\+[1-9][0-9]{7,14}$'
      then regexp_replace(p_phone, '[\s().-]', '', 'g')
  end
$$;

/**
 * Staff to alert for an SOS: supervisors on duty now (a shift in progress, or
 * one whose time window includes now), or every active supervisor if none is;
 * plus every active admin. Never the person who raised it.
 */
create function public.sos_staff_targets(p_except uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with on_duty as (
    select distinct s.officer_id as id
      from public.shifts s
      join public.profiles p on p.id = s.officer_id
     where p.role = 'supervisor' and p.employment_status = 'active'
       and (s.status = 'in_progress'
            or (s.status in ('scheduled', 'acknowledged') and now() >= s.starts_at and now() < s.ends_at))
  ),
  supervisors as (
    select id from on_duty
    union all
    select p.id from public.profiles p
     where p.role = 'supervisor' and p.employment_status = 'active'
       and not exists (select 1 from on_duty)
  )
  select coalesce(array_agg(distinct id), '{}') from (
    select id from supervisors
    union
    select p.id from public.profiles p where p.role = 'admin' and p.employment_status = 'active'
  ) t
  where id is distinct from p_except
$$;

/** Asks the Edge Function to send pending SMS (no-op if functions aren't configured). */
create function public.request_sos_sms()
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
    url := rtrim(v_url, '/') || '/sos-dispatch',
    body := jsonb_build_object('action', 'send_sms'),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'request_sos_sms: %', sqlerrm;
end;
$$;

/** The SMS text for an alert, with its latest position. */
create function public.sos_sms_text(p_alert public.sos_alerts, p_prefix text)
returns text
language sql
stable
set search_path = ''
as $$
  select left(
    p_prefix || ' ' || p_alert.officer_name
    || coalesce(' at ' || p_alert.site_name, '')
    || '. '
    || case
         when p_alert.latitude is null then 'Location not available yet.'
         else 'Location: https://maps.google.com/?q=' || p_alert.latitude || ',' || p_alert.longitude
              || coalesce(' (within ' || round(p_alert.accuracy_m) || ' m)', '')
       end
    || coalesce(' Officer phone: ' || p_alert.officer_phone || '.', ''),
    900
  )
$$;

/** Queues one SMS per number (skips duplicates). Returns how many were queued. */
create function public.queue_sos_sms(p_alert_id uuid, p_targets jsonb, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with rows as (
    insert into public.sos_sms_outbox (alert_id, recipient_name, phone, body)
    select p_alert_id, t ->> 'name', t ->> 'phone', p_body
      from jsonb_array_elements(p_targets) t
     where t ->> 'phone' is not null
    on conflict (alert_id, phone, body) do nothing
    returning 1
  )
  select count(*) into v_count from rows;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispatch and escalation
-- ---------------------------------------------------------------------------

/**
 * Runs every notification round that is due: for this alert, or (null) for all.
 * Safe to call any number of times (rows are locked and skipped if busy).
 */
create function public.sos_run_dispatch(p_alert_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.sos_alerts;
  v_level integer;
  v_staff uuid[];
  v_contact public.sos_contacts;
  v_targets jsonb;
  v_sms integer;
  v_rounds integer := 0;
  v_queued integer := 0;
  v_title text;
  v_body text;
begin
  for v_alert in
    select * from public.sos_alerts a
     where a.status = 'active'
       and a.next_escalation_at <= now()
       and (p_alert_id is null or a.id = p_alert_id)
     order by a.created_at
     for update skip locked
  loop
    v_level := v_alert.escalation_level + 1;
    v_staff := public.sos_staff_targets(v_alert.officer_id);
    v_title := 'SOS: ' || v_alert.officer_name;
    v_body := coalesce(v_alert.site_name, 'Site unknown')
      || case when v_alert.latitude is null then ' · location not available yet'
              else ' · tap for location' end;

    if v_level = 1 then
      -- Round 1: every staff member to alert, by push and SMS.
      perform public.notify_users(
        v_staff, 'sos', v_title, v_body,
        jsonb_build_object('alert_id', v_alert.id), 'sos:' || v_alert.id || ':1'
      );
      select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'phone', public.e164_or_null(p.phone))), '[]')
        into v_targets
        from public.profiles p where p.id = any (v_staff);
      v_sms := public.queue_sos_sms(v_alert.id, v_targets, public.sos_sms_text(v_alert, 'SOS from'));
      insert into public.sos_events (alert_id, type, data)
      values (v_alert.id, 'notified', jsonb_build_object(
        'round', 1,
        'push_user_ids', to_jsonb(v_staff),
        'sms_queued', v_sms,
        'without_sms_number', (select count(*) from jsonb_array_elements(v_targets) t where t ->> 'phone' is null)
      ));
      v_queued := v_queued + v_sms;
    else
      -- Later rounds: the next escalation contact, and staff are reminded.
      select * into v_contact from public.sos_contacts c
       where c.active
       order by c.position, c.created_at
       offset (v_level - 2) limit 1;

      perform public.notify_users(
        v_staff, 'sos', 'Still unacknowledged: ' || v_title, v_body,
        jsonb_build_object('alert_id', v_alert.id), 'sos:' || v_alert.id || ':' || v_level
      );

      if v_contact.id is not null then
        if v_contact.user_id is not null then
          perform public.notify_users(
            array[v_contact.user_id], 'sos', v_title, v_body,
            jsonb_build_object('alert_id', v_alert.id), 'sos:' || v_alert.id || ':contact:' || v_level
          );
        end if;
        v_sms := public.queue_sos_sms(
          v_alert.id,
          jsonb_build_array(jsonb_build_object('name', v_contact.name, 'phone', v_contact.phone)),
          public.sos_sms_text(v_alert, 'UNACKNOWLEDGED SOS from')
        );
        insert into public.sos_events (alert_id, type, data)
        values (v_alert.id, 'escalated', jsonb_build_object(
          'round', v_level, 'contact', v_contact.name, 'sms_queued', v_sms
        ));
        v_queued := v_queued + v_sms;
      else
        insert into public.sos_events (alert_id, type, data)
        values (v_alert.id,
                case when not exists (
                  select 1 from public.sos_events e
                   where e.alert_id = v_alert.id and e.type = 'escalation_exhausted'
                ) then 'escalation_exhausted' else 'reminder' end,
                jsonb_build_object('round', v_level, 'push_user_ids', to_jsonb(v_staff)));
      end if;
    end if;

    update public.sos_alerts
       set escalation_level = v_level,
           next_escalation_at = now() + interval '2 minutes'
     where id = v_alert.id;
    v_rounds := v_rounds + 1;
  end loop;

  -- Pending SMS (new, or failed and due for a retry): ask the Edge Function.
  if v_queued > 0 or exists (
    select 1 from public.sos_sms_outbox o
     where o.status in ('pending', 'failed') and o.next_attempt_at <= now() and o.attempts < 5
  ) or exists (
    select 1 from public.sos_sms_outbox o
     where o.status = 'sending' and o.claimed_at < now() - interval '2 minutes'
  ) then
    perform public.request_sos_sms();
  end if;
  return v_rounds;
end;
$$;

-- ---------------------------------------------------------------------------
-- The officer's side
-- ---------------------------------------------------------------------------

/**
 * Raises an SOS (or returns the caller's alert that is already open, or the one
 * with this id). Site and shift come from the caller's current shift.
 */
create function public.raise_sos(
  p_id uuid,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null,
  p_triggered_at timestamptz default null
)
returns public.sos_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.sos_alerts;
  v_me public.profiles;
  v_shift public.shifts;
  v_site_id uuid;
  v_site_name text;
  v_at timestamptz := now();
  v_alert public.sos_alerts;
begin
  if not public.is_active_user() or v_uid is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'An alert id is required' using errcode = '22023';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid location' using errcode = '22023';
  end if;

  -- A retry, or an alert that is already open: return it.
  select * into v_existing from public.sos_alerts where id = p_id;
  if v_existing.id is not null then
    if v_existing.officer_id <> v_uid then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    return v_existing;
  end if;
  select * into v_existing from public.sos_alerts
   where officer_id = v_uid and status in ('active', 'acknowledged')
   order by created_at desc limit 1;
  if v_existing.id is not null then
    return v_existing;
  end if;

  select * into v_me from public.profiles where id = v_uid;

  -- The shift they are on (or about to start / just finished).
  select * into v_shift from public.shifts s
   where s.officer_id = v_uid
     and s.status <> 'cancelled'
     and now() between s.starts_at - interval '1 hour' and s.ends_at + interval '1 hour'
   order by (s.status = 'in_progress') desc, abs(extract(epoch from (s.starts_at - now())))
   limit 1;
  v_site_id := v_shift.site_id;
  if v_site_id is null then
    -- No shift: their only assigned site, if they have exactly one.
    select min(a.site_id::text)::uuid into v_site_id from public.site_assignments a
     where a.officer_id = v_uid having count(*) = 1;
  end if;
  select name into v_site_name from public.sites where id = v_site_id;

  -- The phone's time, if believable (offline retries arrive later).
  if p_triggered_at is not null
     and p_triggered_at between now() - interval '24 hours' and now() + interval '5 minutes' then
    v_at := least(p_triggered_at, now());
  end if;

  insert into public.sos_alerts (
    id, officer_id, officer_name, officer_phone, site_id, site_name, shift_id,
    latitude, longitude, accuracy_m, location_at, triggered_at, next_escalation_at
  ) values (
    p_id, v_uid, coalesce(nullif(btrim(v_me.full_name), ''), 'Unnamed officer'),
    public.e164_or_null(v_me.phone), v_site_id, v_site_name, v_shift.id,
    p_latitude, p_longitude, case when p_accuracy_m >= 0 then p_accuracy_m end,
    case when p_latitude is not null then v_at end, v_at, now()
  )
  returning * into v_alert;

  if p_latitude is not null then
    insert into public.sos_locations (alert_id, latitude, longitude, accuracy_m, recorded_at)
    values (p_id, p_latitude, p_longitude, case when p_accuracy_m >= 0 then p_accuracy_m end, v_at);
  end if;

  insert into public.sos_events (alert_id, type, actor_id, actor_name, data)
  values (p_id, 'triggered', v_uid, v_alert.officer_name, jsonb_build_object(
    'triggered_at', v_at,
    'latitude', p_latitude, 'longitude', p_longitude, 'accuracy_m', p_accuracy_m,
    'site', v_site_name, 'shift_id', v_shift.id
  ));

  perform public.sos_run_dispatch(p_id);
  select * into v_alert from public.sos_alerts where id = p_id;
  return v_alert;
end;
$$;

/**
 * A newer position for the caller's open alert (every 30 s while the app is in
 * the foreground). Ignored if the last one arrived under 10 s ago.
 */
create function public.sos_location_update(
  p_alert_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_recorded_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.sos_alerts;
  v_at timestamptz := least(coalesce(p_recorded_at, now()), now());
begin
  select * into v_alert from public.sos_alerts where id = p_alert_id for update;
  if not public.is_active_user() or v_alert.id is null or v_alert.officer_id <> auth.uid() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_alert.status not in ('active', 'acknowledged') then
    return false;
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid location' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.sos_locations l
     where l.alert_id = p_alert_id and l.received_at > now() - interval '10 seconds'
  ) then
    return false;
  end if;

  insert into public.sos_locations (alert_id, latitude, longitude, accuracy_m, recorded_at)
  values (p_alert_id, p_latitude, p_longitude, case when p_accuracy_m >= 0 then p_accuracy_m end, v_at);
  update public.sos_alerts
     set latitude = p_latitude, longitude = p_longitude,
         accuracy_m = case when p_accuracy_m >= 0 then p_accuracy_m end,
         location_at = v_at
   where id = p_alert_id;
  return true;
end;
$$;

/** The officer is safe: their own open alert becomes resolved (or a false alarm). */
create function public.sos_mark_safe(p_alert_id uuid, p_false_alarm boolean, p_notes text default null)
returns public.sos_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.sos_alerts;
  v_status public.sos_status := case when p_false_alarm then 'false_alarm' else 'resolved' end;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select * into v_alert from public.sos_alerts where id = p_alert_id for update;
  if not public.is_active_user() or v_alert.id is null or v_alert.officer_id <> auth.uid() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_alert.status not in ('active', 'acknowledged') then
    return v_alert;
  end if;

  update public.sos_alerts
     set status = v_status, resolved_at = now(), resolved_by = auth.uid(),
         resolved_by_name = v_alert.officer_name,
         resolution_notes = coalesce(v_notes, case when p_false_alarm then 'False alarm (officer)' else 'Officer marked safe' end),
         next_escalation_at = null
   where id = p_alert_id
  returning * into v_alert;

  insert into public.sos_events (alert_id, type, actor_id, actor_name, notes, data)
  values (p_alert_id, 'marked_safe', auth.uid(), v_alert.officer_name, v_notes,
          jsonb_build_object('status', v_status));

  perform public.notify_users(
    public.sos_staff_targets(v_alert.officer_id), 'sos_update',
    v_alert.officer_name || (case when p_false_alarm then ': false alarm' else ' is safe' end),
    coalesce(v_notes, 'The SOS was closed by the officer.'),
    jsonb_build_object('alert_id', p_alert_id), 'sos:' || p_alert_id || ':safe'
  );
  return v_alert;
end;
$$;

/** The officer's own actions on the SOS screen, logged (also when sent later from a queue). */
create function public.sos_log_officer_action(
  p_alert_id uuid,
  p_type text,
  p_at timestamptz default null,
  p_data jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.sos_alerts;
begin
  select * into v_alert from public.sos_alerts where id = p_alert_id;
  if not public.is_active_user() or v_alert.id is null or v_alert.officer_id <> auth.uid() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_type not in ('officer_called_emergency', 'officer_called_supervisor', 'officer_sms_fallback') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  insert into public.sos_events (alert_id, type, actor_id, actor_name, data)
  values (p_alert_id, p_type, auth.uid(), v_alert.officer_name,
          coalesce(p_data, '{}') || jsonb_build_object(
            'at', least(coalesce(p_at, now()), now())));
end;
$$;

/**
 * Who the officer should call (and text if offline): supervisors on duty, else
 * every active supervisor, then the escalation contacts. Cached by the phone so
 * the SMS fallback works without a connection.
 */
create function public.sos_contacts_for_me()
returns table (name text, phone text, kind text, sort integer)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select coalesce(p.full_name, 'Supervisor'), public.e164_or_null(p.phone), 'supervisor', 0
      from public.profiles p
     where p.id = any (public.sos_staff_targets(auth.uid()))
       and p.role = 'supervisor'
       and public.e164_or_null(p.phone) is not null
    union all
    select c.name, c.phone, 'escalation', c.position
      from public.sos_contacts c
     where c.active
  ) t (name, phone, kind, sort)
  where public.is_active_user()
  order by sort, name
  limit 10
$$;

-- ---------------------------------------------------------------------------
-- The staff's side
-- ---------------------------------------------------------------------------

create function public.acknowledge_sos(p_alert_id uuid, p_notes text default null)
returns public.sos_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.sos_alerts;
  v_name text;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_alert from public.sos_alerts where id = p_alert_id for update;
  if v_alert.id is null then
    raise exception 'Alert not found' using errcode = 'P0002';
  end if;
  if v_alert.status <> 'active' then
    raise exception 'This alert has already been %', replace(v_alert.status::text, '_', ' ')
      using errcode = 'P0001';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'A supervisor') into v_name
    from public.profiles where id = auth.uid();

  update public.sos_alerts
     set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid(),
         acknowledged_by_name = v_name, acknowledge_notes = v_notes, next_escalation_at = null
   where id = p_alert_id
  returning * into v_alert;

  insert into public.sos_events (alert_id, type, actor_id, actor_name, notes)
  values (p_alert_id, 'acknowledged', auth.uid(), v_name, v_notes);

  perform public.notify_users(
    array[v_alert.officer_id], 'sos_update', 'Help is on the way',
    v_name || ' has your SOS' || coalesce(': ' || v_notes, '.'),
    jsonb_build_object('alert_id', p_alert_id), 'sos:' || p_alert_id || ':ack'
  );
  return v_alert;
end;
$$;

/** Closes an alert as resolved or a false alarm. Notes are required. */
create function public.resolve_sos(p_alert_id uuid, p_status public.sos_status, p_notes text)
returns public.sos_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.sos_alerts;
  v_name text;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status not in ('resolved', 'false_alarm') then
    raise exception 'Choose resolved or false alarm' using errcode = '22023';
  end if;
  if v_notes is null then
    raise exception 'Add a note: what happened and what was done' using errcode = '22023';
  end if;
  select * into v_alert from public.sos_alerts where id = p_alert_id for update;
  if v_alert.id is null then
    raise exception 'Alert not found' using errcode = 'P0002';
  end if;
  if v_alert.status not in ('active', 'acknowledged') then
    raise exception 'This alert is already closed' using errcode = 'P0001';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'A supervisor') into v_name
    from public.profiles where id = auth.uid();

  update public.sos_alerts
     set status = p_status, resolved_at = now(), resolved_by = auth.uid(),
         resolved_by_name = v_name, resolution_notes = v_notes, next_escalation_at = null,
         -- Resolving without acknowledging first counts as acknowledging too.
         acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid()),
         acknowledged_by_name = coalesce(acknowledged_by_name, v_name)
   where id = p_alert_id
  returning * into v_alert;

  insert into public.sos_events (alert_id, type, actor_id, actor_name, notes)
  values (p_alert_id, p_status::text, auth.uid(), v_name, v_notes);

  perform public.notify_users(
    array[v_alert.officer_id], 'sos_update',
    case when p_status = 'resolved' then 'SOS resolved' else 'SOS closed as a false alarm' end,
    v_name || ': ' || v_notes,
    jsonb_build_object('alert_id', p_alert_id), 'sos:' || p_alert_id || ':closed'
  );
  return v_alert;
end;
$$;

-- ---------------------------------------------------------------------------
-- SMS outbox (Edge Function, service role)
-- ---------------------------------------------------------------------------

/** Claims SMS due for sending (pending, failed and due, or stuck in "sending"). */
create function public.claim_sos_sms(p_limit integer default 50)
returns setof public.sos_sms_outbox
language sql
security definer
set search_path = ''
as $$
  update public.sos_sms_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select x.id from public.sos_sms_outbox x
      where (x.status in ('pending', 'failed') and x.next_attempt_at <= now() and x.attempts < 5)
         or (x.status = 'sending' and x.claimed_at < now() - interval '2 minutes')
      order by x.created_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked
   )
  returning o.*
$$;

/** Records how a claimed SMS went, and logs it on the alert. */
create function public.finish_sos_sms(
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
  v_row public.sos_sms_outbox;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  update public.sos_sms_outbox
     set status = case when p_status = 'failed' and attempts >= 5 then 'failed' else p_status end,
         provider_id = coalesce(p_provider_id, provider_id),
         error = left(p_error, 500),
         sent_at = case when p_status = 'sent' then now() end,
         -- Back off: 15 s, 30 s, 60 s, 120 s.
         next_attempt_at = now() + (interval '15 seconds' * power(2, greatest(attempts - 1, 0)))
   where id = p_id
  returning * into v_row;
  if v_row.id is null then
    return;
  end if;
  insert into public.sos_events (alert_id, type, data)
  values (v_row.alert_id, 'sms_' || p_status, jsonb_build_object(
    'to', v_row.recipient_name, 'phone', v_row.phone, 'attempt', v_row.attempts,
    'provider_id', p_provider_id, 'error', left(p_error, 500)
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.sos_alerts enable row level security;
alter table public.sos_locations enable row level security;
alter table public.sos_events enable row level security;
alter table public.sos_contacts enable row level security;
alter table public.sos_sms_outbox enable row level security;

create function public.can_see_sos(p_alert_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and (
    public.is_staff()
    or exists (select 1 from public.sos_alerts a where a.id = p_alert_id and a.officer_id = auth.uid())
  )
$$;

create policy "sos_alerts: the officer and staff read"
  on public.sos_alerts for select to authenticated
  using ((select public.is_active_user())
         and (officer_id = (select auth.uid()) or (select public.is_staff())));

create policy "sos_locations: the officer and staff read"
  on public.sos_locations for select to authenticated
  using (public.can_see_sos(alert_id));

create policy "sos_events: the officer and staff read"
  on public.sos_events for select to authenticated
  using (public.can_see_sos(alert_id));

create policy "sos_contacts: staff read"
  on public.sos_contacts for select to authenticated
  using ((select public.is_staff()));

create policy "sos_contacts: admins insert"
  on public.sos_contacts for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "sos_contacts: admins update"
  on public.sos_contacts for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "sos_contacts: admins delete"
  on public.sos_contacts for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "sos_sms_outbox: staff read"
  on public.sos_sms_outbox for select to authenticated
  using ((select public.is_staff()));

-- Explicit grants (this project doesn't grant new tables automatically).
grant select on public.sos_alerts, public.sos_locations, public.sos_events, public.sos_sms_outbox
  to authenticated;
grant select, insert, update, delete on public.sos_contacts to authenticated;
grant all on public.sos_alerts, public.sos_locations, public.sos_events, public.sos_contacts,
  public.sos_sms_outbox to service_role;

revoke execute on function public.sos_staff_targets from public, anon, authenticated;
revoke execute on function public.request_sos_sms from public, anon, authenticated;
revoke execute on function public.queue_sos_sms from public, anon, authenticated;
revoke execute on function public.sos_run_dispatch from public, anon, authenticated;
revoke execute on function public.claim_sos_sms from public, anon, authenticated;
revoke execute on function public.finish_sos_sms from public, anon, authenticated;
grant execute on function public.sos_run_dispatch to service_role;
grant execute on function public.claim_sos_sms to service_role;
grant execute on function public.finish_sos_sms to service_role;

revoke execute on function public.raise_sos from public, anon;
revoke execute on function public.sos_location_update from public, anon;
revoke execute on function public.sos_mark_safe from public, anon;
revoke execute on function public.sos_log_officer_action from public, anon;
revoke execute on function public.sos_contacts_for_me from public, anon;
revoke execute on function public.acknowledge_sos from public, anon;
revoke execute on function public.resolve_sos from public, anon;
revoke execute on function public.can_see_sos from public, anon;
grant execute on function public.raise_sos to authenticated;
grant execute on function public.sos_location_update to authenticated;
grant execute on function public.sos_mark_safe to authenticated;
grant execute on function public.sos_log_officer_action to authenticated;
grant execute on function public.sos_contacts_for_me to authenticated;
grant execute on function public.acknowledge_sos to authenticated;
grant execute on function public.resolve_sos to authenticated;
grant execute on function public.can_see_sos to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime and schedule
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.sos_alerts, public.sos_locations, public.sos_events;

-- Escalation rounds and SMS retries.
select cron.schedule('sos-dispatch', '15 seconds', 'select public.sos_run_dispatch(null)');
