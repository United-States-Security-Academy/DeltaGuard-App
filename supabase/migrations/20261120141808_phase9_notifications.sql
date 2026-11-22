-- Phase 9: notifications (in-app inbox + Expo push).
--
-- notifications   every alert, one row per recipient. This is the in-app inbox
--                 and the push outbox: push_status says whether it reached a
--                 phone. Optional dedupe_key makes "send once" alerts safe to
--                 retry (unique per user).
-- push_tickets    Expo push tickets, checked later for receipts (so tokens of
--                 uninstalled apps are removed).
--
-- Flow:
--   trigger / cron job
--     -> notify_users(...)        inserts the rows in the SAME transaction (the
--                                 inbox never misses an alert, and a rolled
--                                 back change sends nothing)
--     -> request_push_delivery()  pg_net POST to the send-notification Edge
--                                 Function with the new row ids (sent after
--                                 commit)
--   send-notification            looks up the users' active device tokens,
--                                 sends through the Expo Push API, records
--                                 tickets, clears tokens Expo reports as
--                                 DeviceNotRegistered, marks rows sent/failed.
--   cron 'push-maintenance'      every 5 min: retries pending pushes and
--                                 checks receipts.
--
-- One-time setup per Supabase project (not in a migration: it differs per
-- environment). Without it the inbox works and pushes stay pending:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1',
--                              'deltaguard_functions_url');
--
-- Alerts:
--   shift assigned / changed / cancelled / removed     -> the officer
--   60 minutes before a shift                          -> the officer
--   missed clock-in, flagged clock-in                  -> active supervisors
--   licence expiring in 30 and 7 days (once each)      -> the officer and admins
--   incident submitted or resubmitted                  -> active supervisors

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Device reset clears the push token (and so stops pushes to that phone)
-- ---------------------------------------------------------------------------

create function public.user_devices_clear_push_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revoked_at is not null then
    new.push_token := null;
  end if;
  return new;
end;
$$;

create trigger user_devices_clear_push_token
  before insert or update on public.user_devices
  for each row execute function public.user_devices_clear_push_token();

update public.user_devices set push_token = null where revoked_at is not null;

-- Expo tokens look like ExponentPushToken[xxxx] (or ExpoPushToken[xxxx]).
alter table public.user_devices add constraint user_devices_push_token_format
  check (push_token is null or push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$');

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (char_length(type) between 1 and 50),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) <= 1000),
  -- Where tapping it leads, e.g. {"shift_id": "..."}.
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  dedupe_key text check (char_length(dedupe_key) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  push_status text not null default 'pending'
    check (push_status in ('pending', 'sent', 'no_device', 'failed')),
  push_attempts integer not null default 0,
  pushed_at timestamptz,
  push_error text,
  unique (user_id, dedupe_key)
);

comment on table public.notifications is
  'In-app inbox and push outbox. Written only by notify_users(); users may only mark their own as read.';

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_pending_idx on public.notifications (created_at) where push_status = 'pending';

-- Users may only set read_at on their own rows.
create function public.notifications_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at')
  then
    raise exception 'Only read_at can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

create table public.push_tickets (
  id text primary key, -- Expo ticket id
  notification_id uuid not null references public.notifications (id) on delete cascade,
  device_id uuid references public.user_devices (id) on delete cascade,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  receipt_status text,
  receipt_error text
);

create index push_tickets_unchecked_idx on public.push_tickets (created_at) where checked_at is null;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

/** Asks the Edge Function to push these rows. Never fails the caller. */
create function public.request_push_delivery(p_notification_ids uuid[] default null)
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
    return; -- push not configured on this project: the inbox still works
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/send-notification',
    body := case
      when p_notification_ids is null then jsonb_build_object('action', 'maintenance')
      else jsonb_build_object('notification_ids', to_jsonb(p_notification_ids))
    end,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'request_push_delivery: %', sqlerrm;
end;
$$;

/**
 * The one way to create notifications. Skips inactive users and rows whose
 * dedupe_key that user already has. Returns how many were created.
 */
create function public.notify_users(
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default '{}',
  p_dedupe_key text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with inserted as (
    insert into public.notifications (user_id, type, title, body, data, dedupe_key)
    select u, p_type, left(p_title, 200), left(coalesce(p_body, ''), 1000),
           coalesce(p_data, '{}'), p_dedupe_key
      from (select distinct unnest(p_user_ids) as u) recipients
     where exists (
       select 1 from public.profiles pr where pr.id = u and pr.employment_status = 'active'
     )
    on conflict (user_id, dedupe_key) do nothing
    returning id
  )
  select array_agg(id) into v_ids from inserted;

  if v_ids is not null then
    perform public.request_push_delivery(v_ids);
  end if;
  return coalesce(cardinality(v_ids), 0);
end;
$$;

revoke execute on function public.request_push_delivery from public, anon, authenticated;
revoke execute on function public.notify_users from public, anon, authenticated;
grant execute on function public.notify_users to service_role;

/** Active supervisors, except `p_except` (e.g. the officer the alert is about). */
create function public.active_supervisor_ids(p_except uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from public.profiles
   where role = 'supervisor' and employment_status = 'active' and id is distinct from p_except
$$;

create function public.active_admin_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from public.profiles
   where role = 'admin' and employment_status = 'active'
$$;

/** "Mon 5 Jan 22:00-06:00" in the company time zone. */
create function public.format_shift_time(p_starts_at timestamptz, p_ends_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_starts_at at time zone tz, 'Dy FMDD Mon HH24:MI') || '–'
         || to_char(p_ends_at at time zone tz, 'HH24:MI')
    from (select s.time_zone as tz from public.settings s where s.id) z
$$;

revoke execute on function public.active_supervisor_ids from public, anon, authenticated;
revoke execute on function public.active_admin_ids from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shifts: assigned (batched per officer), changed, cancelled, removed, missed
-- ---------------------------------------------------------------------------

create function public.notify_shifts_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select n.officer_id, count(*) as n,
           (array_agg(n.id order by n.starts_at))[1] as first_id,
           min(n.starts_at) as first_start
      from new_shifts n
     where n.status <> 'cancelled' and n.ends_at > now()
     group by n.officer_id
  loop
    if r.n = 1 then
      perform public.notify_users(
        array[r.officer_id], 'shift_assigned', 'New shift',
        (select public.format_shift_time(s.starts_at, s.ends_at) || ' at ' || si.name
           || '. Open DeltaGuard to acknowledge it.'
           from public.shifts s join public.sites si on si.id = s.site_id where s.id = r.first_id),
        jsonb_build_object('shift_id', r.first_id)
      );
    else
      perform public.notify_users(
        array[r.officer_id], 'shift_assigned', r.n || ' new shifts',
        'Starting ' || to_char(r.first_start at time zone (select time_zone from public.settings where id),
                               'Dy FMDD Mon') || '. Open DeltaGuard to acknowledge them.',
        '{}'::jsonb
      );
    end if;
  end loop;
  return null;
end;
$$;

create trigger shifts_notify_inserted
  after insert on public.shifts
  referencing new table as new_shifts
  for each statement execute function public.notify_shifts_inserted();

create function public.notify_shift_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_when text := public.format_shift_time(new.starts_at, new.ends_at);
  v_site text := (select name from public.sites where id = new.site_id);
  v_officer text := (select coalesce(full_name, 'An officer') from public.profiles where id = new.officer_id);
begin
  -- Missed clock-in -> supervisors (the job marks the shift missed).
  if new.status = 'missed' and old.status is distinct from 'missed' then
    perform public.notify_users(
      public.active_supervisor_ids(new.officer_id), 'clock_in_missed', 'Missed clock-in',
      v_officer || ' didn''t clock in at ' || v_site || ' (' || v_when || ').',
      jsonb_build_object('shift_id', new.id), 'clock_in_missed:' || new.id
    );
    return null;
  end if;

  if new.ends_at <= now() then
    return null; -- edits to past shifts don't concern the officer any more
  end if;

  if new.officer_id is distinct from old.officer_id then
    if old.status <> 'cancelled' then
      perform public.notify_users(
        array[old.officer_id], 'shift_cancelled', 'Shift removed',
        'You are no longer on ' || public.format_shift_time(old.starts_at, old.ends_at) || ' at '
          || (select name from public.sites where id = old.site_id) || '.',
        '{}'::jsonb
      );
    end if;
    if new.status <> 'cancelled' then
      perform public.notify_users(
        array[new.officer_id], 'shift_assigned', 'New shift',
        v_when || ' at ' || v_site || '. Open DeltaGuard to acknowledge it.',
        jsonb_build_object('shift_id', new.id)
      );
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.notify_users(
      array[new.officer_id], 'shift_cancelled', 'Shift cancelled',
      v_when || ' at ' || v_site || ' was cancelled. You don''t need to attend.',
      jsonb_build_object('shift_id', new.id)
    );
  elsif new.status <> 'cancelled'
        and (new.starts_at, new.ends_at, new.site_id) is distinct from (old.starts_at, old.ends_at, old.site_id)
  then
    perform public.notify_users(
      array[new.officer_id], 'shift_changed', 'Shift changed',
      'Now ' || v_when || ' at ' || v_site || '. Open DeltaGuard to acknowledge the change.',
      jsonb_build_object('shift_id', new.id)
    );
  end if;
  return null;
end;
$$;

create trigger shifts_notify_updated
  after update of officer_id, site_id, starts_at, ends_at, status on public.shifts
  for each row execute function public.notify_shift_updated();

-- ---------------------------------------------------------------------------
-- Flagged clock-in -> supervisors
-- ---------------------------------------------------------------------------

create function public.notify_flagged_clock_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flags text[];
  v_shift public.shifts;
begin
  if new.type <> 'clock_in' then
    return null;
  end if;
  -- The flags a supervisor acts on (not low_accuracy / delayed on their own).
  select array_agg(f) into v_flags from unnest(new.flags) f
   where f in ('late', 'out_of_range', 'mock_location', 'wrong_device', 'post_orders_unread');
  if v_flags is null then
    return null;
  end if;

  select * into v_shift from public.shifts where id = new.shift_id;
  perform public.notify_users(
    public.active_supervisor_ids(new.officer_id),
    'clock_in_flagged',
    case when new.accepted then 'Flagged clock-in' else 'Refused clock-in' end,
    (select coalesce(full_name, 'An officer') from public.profiles where id = new.officer_id)
      || ' at ' || (select name from public.sites where id = v_shift.site_id) || ': '
      || (select string_agg(case f
            when 'late' then 'late'
            when 'out_of_range' then 'outside the site radius'
              || coalesce(' (' || round(new.distance_from_site_m) || ' m)', '')
            when 'mock_location' then 'fake GPS detected'
            when 'wrong_device' then 'unregistered phone'
            when 'post_orders_unread' then 'post orders not acknowledged'
          end, ', ') from unnest(v_flags) f) || '.',
    jsonb_build_object('shift_id', new.shift_id),
    'clock_in_flagged:' || new.id
  );
  return null;
end;
$$;

create trigger attendance_events_notify_flagged
  after insert on public.attendance_events
  for each row execute function public.notify_flagged_clock_in();

-- ---------------------------------------------------------------------------
-- Incident submitted -> supervisors
-- ---------------------------------------------------------------------------

create function public.notify_incident_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted') then
    return null;
  end if;
  perform public.notify_users(
    public.active_supervisor_ids(new.officer_id),
    'incident_submitted',
    case when new.severity in ('high', 'critical') then upper(new.severity::text) || ': ' else '' end
      || initcap(replace(new.category, '_', ' '))
      || case when tg_op = 'UPDATE' then ' report resubmitted' else ' reported' end,
    (select coalesce(full_name, 'An officer') from public.profiles where id = new.officer_id)
      || ' at ' || (select name from public.sites where id = new.site_id)
      || case when new.police_called then '. Police called.' else '.' end,
    jsonb_build_object('incident_id', new.id),
    'incident_submitted:' || new.id || ':' || extract(epoch from new.submitted_at)::bigint
  );
  return null;
end;
$$;

create trigger incidents_notify_submitted
  after insert or update of status on public.incidents
  for each row execute function public.notify_incident_submitted();

-- ---------------------------------------------------------------------------
-- Scheduled: shift reminders (every 5 min), licence expiry (hourly)
-- ---------------------------------------------------------------------------

create function public.notify_upcoming_shifts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select s.id, s.officer_id, s.starts_at, s.ends_at, si.name as site
      from public.shifts s join public.sites si on si.id = s.site_id
     where s.status in ('scheduled', 'acknowledged')
       and s.starts_at > now()
       and s.starts_at <= now() + interval '60 minutes'
       -- Just assigned: the "New shift" alert already said when.
       and s.created_at < now() - interval '10 minutes'
  loop
    v_count := v_count + public.notify_users(
      array[r.officer_id], 'shift_reminder',
      'Shift starts in ' || greatest(1, ceil(extract(epoch from r.starts_at - now()) / 60))::int || ' min',
      public.format_shift_time(r.starts_at, r.ends_at) || ' at ' || r.site
        || '. Open DeltaGuard to clock in when you arrive.',
      jsonb_build_object('shift_id', r.id),
      'shift_reminder:' || r.id || ':' || extract(epoch from r.starts_at)::bigint
    );
  end loop;
  return v_count;
end;
$$;

create function public.notify_expiring_licences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone (select time_zone from public.settings where id))::date;
  r record;
  v_count integer := 0;
  v_key text;
begin
  for r in
    select q.id, q.user_id, q.type, q.expires_on, p.full_name,
           case when q.expires_on <= v_today + 7 then 7 else 30 end as notice,
           q.expires_on - v_today as days_left
      from public.qualifications q
      join public.profiles p on p.id = q.user_id and p.employment_status = 'active'
     where q.expires_on between v_today and v_today + 30
  loop
    -- Once per licence, expiry date and notice (a renewed licence starts over).
    v_key := 'licence_expiring:' || r.id || ':' || r.expires_on || ':' || r.notice;
    v_count := v_count + public.notify_users(
      array[r.user_id], 'licence_expiring',
      'Your ' || r.type || ' expires '
        || case when r.days_left = 0 then 'today' when r.days_left = 1 then 'tomorrow'
                else 'in ' || r.days_left || ' days' end,
      'It expires on ' || to_char(r.expires_on, 'FMDD Mon YYYY')
        || '. Renew it and give the new licence to your supervisor.',
      jsonb_build_object('qualification_id', r.id),
      v_key
    );
    v_count := v_count + public.notify_users(
      array(select unnest(public.active_admin_ids()) except select r.user_id),
      'licence_expiring',
      coalesce(r.full_name, 'An officer') || '''s ' || r.type || ' expires '
        || case when r.days_left = 0 then 'today' when r.days_left = 1 then 'tomorrow'
                else 'in ' || r.days_left || ' days' end,
      'Expires ' || to_char(r.expires_on, 'FMDD Mon YYYY') || '.',
      jsonb_build_object('qualification_id', r.id, 'officer_id', r.user_id),
      v_key
    );
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.notify_upcoming_shifts from public, anon, authenticated;
revoke execute on function public.notify_expiring_licences from public, anon, authenticated;

select cron.schedule('notify-upcoming-shifts', '*/5 * * * *', 'select public.notify_upcoming_shifts()');
select cron.schedule('notify-expiring-licences', '15 * * * *', 'select public.notify_expiring_licences()');
-- Retry pushes that didn't go out and check Expo receipts.
select cron.schedule('push-maintenance', '*/5 * * * *', 'select public.request_push_delivery(null)');

-- ---------------------------------------------------------------------------
-- RLS + Realtime
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;
alter table public.push_tickets enable row level security;

revoke all on public.notifications, public.push_tickets from anon, authenticated;
grant select, update on public.notifications to authenticated;
grant all on public.notifications, public.push_tickets to service_role;
-- push_tickets: no policies, so only the service role (Edge Function) uses it.

create policy "notifications: users read their own"
  on public.notifications for select to authenticated
  using ((select public.is_active_user()) and user_id = (select auth.uid()));

create policy "notifications: users mark their own read"
  on public.notifications for update to authenticated
  using ((select public.is_active_user()) and user_id = (select auth.uid()))
  with check ((select public.is_active_user()) and user_id = (select auth.uid()));

alter publication supabase_realtime add table public.notifications;
