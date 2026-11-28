-- Phase 17b: welfare checks in the admin console.
--
--   sites.welfare_checks_enabled  per-site switch (admins only). Off = no checks
--                                 at that site whatever its policy.
--   acknowledge_welfare_check()   staff take an escalated check ("I'm on it"):
--                                 stops the console alarm for everyone, logged,
--                                 other alerted staff are told who has it.
--   welfare_pauses                admins pause checks for one shift in progress
--                                 with a reason (e.g. approved break), until a
--                                 time or until resumed. Append-only audit
--                                 trail (who, when, why, who resumed); the
--                                 cancelled check's escalation_log says so too.
--   welfare_board()               every shift in progress the caller may watch,
--                                 with its policy, open / last check, heartbeat
--                                 and pause (the live board and dashboard).
--   welfare_check_rows() /        per-check rows and per officer / site totals
--   welfare_report()              for a date range, optionally night or day
--                                 only. SECURITY INVOKER: RLS scopes them.
--
-- Definitions used by the reports (one place, so the console and CSV agree):
--   prompted   the check came due (prompted, or answered right at its time)
--   answered   the officer answered (responded_at set), late or not
--   missed     the check escalated or was closed by staff without a timely
--              answer (no answer, or only after escalation). Checks cancelled
--              by clock-out or a pause are not missed.
--   escalated  supervisors were alerted (an "escalated" step in the log)

-- ---------------------------------------------------------------------------
-- Per-site switch
-- ---------------------------------------------------------------------------

alter table public.sites
  add column welfare_checks_enabled boolean not null default true;
comment on column public.sites.welfare_checks_enabled is
  'Welfare checks at this site. False turns them off whatever the policy. Admins only.';

drop trigger sites_guard_welfare_policy on public.sites;
create trigger sites_guard_welfare_policy
  before update on public.sites
  for each row execute function public.guard_admin_only_columns('welfare_policy_id', 'welfare_checks_enabled');

/** The enabled policy for a site (its own, else the company default), or null when checks are off there. */
create or replace function public.welfare_policy_for_site(p_site_id uuid)
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
     and coalesce((select s.welfare_checks_enabled from public.sites s where s.id = p_site_id), false)
$$;

-- ---------------------------------------------------------------------------
-- Acknowledging an escalated check
-- ---------------------------------------------------------------------------

alter table public.welfare_checks
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid references public.profiles (id) on delete set null;

/**
 * A staff member takes an escalated check. The first acknowledgement counts;
 * repeating it changes nothing. Notes are optional (logged). Returns the check.
 */
create function public.acknowledge_welfare_check(p_check_id uuid, p_notes text default null)
returns public.welfare_checks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.welfare_checks;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_name text;
  v_officer text;
begin
  if not public.can_manage_welfare_check(p_check_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'The note is too long (2000 characters at most)' using errcode = '22023';
  end if;
  select * into v_check from public.welfare_checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'Welfare check not found' using errcode = 'P0002';
  end if;
  if v_check.status <> 'escalated' then
    raise exception 'Only an escalated check can be acknowledged' using errcode = 'P0001';
  end if;
  if v_check.acknowledged_at is not null then
    return v_check;
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'A supervisor') into v_name
    from public.profiles where id = auth.uid();
  select coalesce(nullif(btrim(full_name), ''), 'the officer') into v_officer
    from public.profiles where id = v_check.officer_id;

  update public.welfare_checks
     set acknowledged_at = now(), acknowledged_by = auth.uid()
   where id = p_check_id
  returning * into v_check;
  perform public.welfare_log(p_check_id, 'acknowledged', now(),
    jsonb_build_object('by', v_name, 'by_id', auth.uid(), 'notes', v_notes));

  perform public.notify_users(
    array(select u from unnest(v_check.alerted_user_ids) u where u <> auth.uid()),
    'welfare_update', v_name || ' is handling the welfare alert',
    'Missed welfare check by ' || v_officer || coalesce('. ' || v_notes, '.'),
    jsonb_build_object('check_id', p_check_id), 'welfare:' || p_check_id || ':acknowledged'
  );
  return v_check;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pausing checks for a shift
-- ---------------------------------------------------------------------------

create table public.welfare_pauses (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete restrict,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  paused_at timestamptz not null default now(),
  paused_by uuid references public.profiles (id) on delete set null,
  paused_by_name text,
  -- Planned end; null = until someone resumes (or the shift ends).
  resume_at timestamptz,
  resumed_at timestamptz,
  resumed_by uuid references public.profiles (id) on delete set null,
  resumed_by_name text,
  resume_reason text check (resume_reason in ('manual', 'scheduled', 'shift_ended')),
  check (resume_at is null or resume_at > paused_at),
  check ((resumed_at is null) = (resume_reason is null))
);

comment on table public.welfare_pauses is
  'Welfare checks paused for one shift by an admin, with the reason (audit trail). Written only by pause/resume functions.';

-- One open pause per shift.
create unique index welfare_pauses_one_open_per_shift
  on public.welfare_pauses (shift_id) where resumed_at is null;
create index welfare_pauses_due_idx on public.welfare_pauses (resume_at)
  where resumed_at is null and resume_at is not null;
create index welfare_pauses_officer_idx on public.welfare_pauses (officer_id, paused_at desc);

/** Whether checks for this shift are paused right now. */
create function public.welfare_shift_paused(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.welfare_pauses p
     where p.shift_id = p_shift_id and p.resumed_at is null
       and (p.resume_at is null or p.resume_at > now())
  )
$$;

-- welfare_schedule_next as in phase 17, plus: nothing while paused.
create or replace function public.welfare_schedule_next(p_shift_id uuid, p_from timestamptz)
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
  if public.welfare_shift_paused(p_shift_id) then
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

/**
 * Admins: pause checks for a shift in progress. Cancels the open check (an
 * escalated one stays for a supervisor to resolve) and tells the officer.
 * p_resume_at: when checks start again (optional; before the shift ends).
 */
create function public.pause_welfare_checks(
  p_shift_id uuid,
  p_reason text,
  p_resume_at timestamptz default null
)
returns public.welfare_pauses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name text;
  v_pause public.welfare_pauses;
  v_id uuid;
begin
  if not (public.is_active_user() and public.auth_role() = 'admin') then
    raise exception 'Only admins can pause welfare checks' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for the pause' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'The reason is too long (500 characters at most)' using errcode = '22023';
  end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if v_shift.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  if v_shift.status <> 'in_progress' then
    raise exception 'Checks can only be paused while the officer is on shift' using errcode = 'P0001';
  end if;
  if p_resume_at is not null and p_resume_at <= now() then
    raise exception 'The resume time must be in the future' using errcode = '22023';
  end if;
  if p_resume_at is not null and p_resume_at >= v_shift.ends_at then
    raise exception 'The resume time must be before the shift ends (leave it empty to pause until the end)'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.welfare_pauses where shift_id = p_shift_id and resumed_at is null) then
    raise exception 'Checks for this shift are already paused' using errcode = 'P0001';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'An admin') into v_name
    from public.profiles where id = auth.uid();

  insert into public.welfare_pauses (
    shift_id, officer_id, site_id, reason, paused_by, paused_by_name, resume_at
  ) values (
    v_shift.id, v_shift.officer_id, v_shift.site_id, v_reason, auth.uid(), v_name, p_resume_at
  )
  returning * into v_pause;

  for v_id in
    update public.welfare_checks
       set status = 'cancelled', step_due_at = null
     where shift_id = p_shift_id and status in ('scheduled', 'prompted', 'alarm', 'calling')
    returning id
  loop
    perform public.welfare_log(v_id, 'cancelled', now(), jsonb_build_object(
      'reason', 'paused', 'pause_id', v_pause.id, 'by', v_name, 'by_id', auth.uid(),
      'notes', v_reason, 'resume_at', p_resume_at));
  end loop;

  perform public.notify_users(
    array[v_shift.officer_id], 'welfare_paused', 'Welfare checks paused',
    v_reason || coalesce(' · until ' || public.welfare_local_time(p_resume_at), ''),
    jsonb_build_object('shift_id', v_shift.id, 'pause_id', v_pause.id),
    'welfare:pause:' || v_pause.id
  );
  return v_pause;
end;
$$;

/** Ends a pause and schedules the next check. Internal. */
create function public.welfare_end_pause(
  p_pause_id uuid,
  p_reason text,
  p_by uuid,
  p_at timestamptz
)
returns public.welfare_pauses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pause public.welfare_pauses;
  v_name text;
begin
  if p_by is not null then
    select coalesce(nullif(btrim(full_name), ''), 'An admin') into v_name
      from public.profiles where id = p_by;
  end if;
  update public.welfare_pauses
     set resumed_at = p_at, resumed_by = p_by, resumed_by_name = v_name, resume_reason = p_reason
   where id = p_pause_id and resumed_at is null
  returning * into v_pause;
  if v_pause.id is null then
    return null;
  end if;
  if p_reason <> 'shift_ended' then
    perform public.welfare_schedule_next(v_pause.shift_id, now());
    perform public.notify_users(
      array[v_pause.officer_id], 'welfare_resumed', 'Welfare checks resumed',
      'Welfare checks are back on for this shift.',
      jsonb_build_object('shift_id', v_pause.shift_id, 'pause_id', v_pause.id),
      'welfare:resume:' || v_pause.id
    );
  end if;
  return v_pause;
end;
$$;

/** Admins: resume checks for a paused shift now. */
create function public.resume_welfare_checks(p_shift_id uuid)
returns public.welfare_pauses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.is_active_user() and public.auth_role() = 'admin') then
    raise exception 'Only admins can resume welfare checks' using errcode = '42501';
  end if;
  select id into v_id from public.welfare_pauses
   where shift_id = p_shift_id and resumed_at is null
   for update;
  if v_id is null then
    raise exception 'Checks for this shift aren''t paused' using errcode = 'P0001';
  end if;
  return public.welfare_end_pause(v_id, 'manual', auth.uid(), now());
end;
$$;

/** pg_cron: pauses whose resume time has come. Returns how many resumed. */
create function public.welfare_resume_due_pauses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_at timestamptz;
  v_count integer := 0;
begin
  for v_id, v_at in
    select id, resume_at from public.welfare_pauses
     where resumed_at is null and resume_at <= now()
     order by resume_at
     for update skip locked
  loop
    perform public.welfare_end_pause(v_id, 'scheduled', null, v_at);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

/** A shift leaving in_progress closes its pause. */
create function public.welfare_pauses_on_shift_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if old.status = 'in_progress' and new.status <> 'in_progress' then
    for v_id in
      select id from public.welfare_pauses where shift_id = new.id and resumed_at is null
    loop
      perform public.welfare_end_pause(v_id, 'shift_ended', null, now());
    end loop;
  end if;
  return null;
end;
$$;

create trigger shifts_welfare_pauses
  after update of status on public.shifts
  for each row execute function public.welfare_pauses_on_shift_status();

-- ---------------------------------------------------------------------------
-- Board and reports (SECURITY INVOKER: RLS decides what each caller sees)
-- ---------------------------------------------------------------------------

/**
 * Every shift in progress the caller may watch (admins: all; supervisors:
 * their sites), with the effective policy, the open check (escalated first),
 * the last finished check, this shift's totals, the phone's heartbeat and an
 * open pause.
 */
create function public.welfare_board()
returns table (
  shift_id uuid,
  officer_id uuid,
  officer_name text,
  officer_phone text,
  site_id uuid,
  site_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  checks_enabled boolean,
  policy_id uuid,
  policy_name text,
  open_check_id uuid,
  open_status public.welfare_check_status,
  open_scheduled_at timestamptz,
  open_prompted_at timestamptz,
  open_acknowledged_at timestamptz,
  last_check_id uuid,
  last_status public.welfare_check_status,
  last_scheduled_at timestamptz,
  last_responded_at timestamptz,
  last_response_seconds integer,
  last_response_flags text[],
  answered_count integer,
  missed_count integer,
  heartbeat_at timestamptz,
  battery_level integer,
  app_state text,
  pause_id uuid,
  pause_reason text,
  paused_at timestamptz,
  pause_resume_at timestamptz,
  paused_by_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id, s.officer_id, o.full_name, o.phone, s.site_id, si.name, s.starts_at, s.ends_at,
    (si.welfare_checks_enabled and coalesce(p.enabled, false)), p.id, p.name,
    oc.id, oc.status, oc.scheduled_at, oc.prompted_at, oc.acknowledged_at,
    lc.id, lc.status, lc.scheduled_at, lc.responded_at, lc.response_seconds, lc.response_flags,
    coalesce(t.answered, 0), coalesce(t.missed, 0),
    hb.last_seen_at, hb.battery_level, hb.app_state,
    wp.id, wp.reason, wp.paused_at, wp.resume_at, wp.paused_by_name
  from public.shifts s
  join public.sites si on si.id = s.site_id
  left join public.profiles o on o.id = s.officer_id
  left join public.welfare_check_policies p
    on p.id = coalesce(si.welfare_policy_id, (select st.welfare_policy_id from public.settings st where st.id))
  left join lateral (
    select c.* from public.welfare_checks c
     where c.shift_id = s.id and c.status in ('scheduled', 'prompted', 'alarm', 'calling', 'escalated')
     order by (c.status = 'escalated') desc, c.scheduled_at
     limit 1
  ) oc on true
  left join lateral (
    select c.* from public.welfare_checks c
     where c.shift_id = s.id and c.status in ('responded', 'resolved', 'escalated')
       and c.id is distinct from oc.id
     order by c.scheduled_at desc
     limit 1
  ) lc on true
  left join lateral (
    select count(*) filter (where c.responded_at is not null)::int as answered,
           count(*) filter (where c.status in ('escalated', 'resolved')
                             and (c.responded_at is null or 'after_escalation' = any (c.response_flags)))::int as missed
      from public.welfare_checks c where c.shift_id = s.id
  ) t on true
  left join public.device_heartbeats hb on hb.officer_id = s.officer_id
  left join public.welfare_pauses wp on wp.shift_id = s.id and wp.resumed_at is null
  where s.status = 'in_progress'
    and public.is_active_user()
    and (public.auth_role() = 'admin'
         or (public.auth_role() = 'supervisor' and public.supervises_site(s.site_id)))
  order by o.full_name nulls last, s.starts_at
$$;

/**
 * One row per check that came due in [p_from, p_to] (days in the company time
 * zone, by the time it came due), optionally only night ('night') or day
 * ('day') hours between p_night_start and p_night_end (may wrap midnight), and
 * optionally one officer / site / shift.
 */
create function public.welfare_check_rows(
  p_from date,
  p_to date,
  p_period text default 'all',
  p_night_start time default '22:00',
  p_night_end time default '06:00',
  p_officer_id uuid default null,
  p_site_id uuid default null,
  p_shift_id uuid default null
)
returns table (
  check_id uuid,
  shift_id uuid,
  officer_id uuid,
  officer_name text,
  site_id uuid,
  site_name text,
  status public.welfare_check_status,
  due_at timestamptz,
  local_date date,
  local_time time,
  is_night boolean,
  prompted_at timestamptz,
  responded_at timestamptz,
  response_seconds integer,
  response_flags text[],
  answered boolean,
  missed boolean,
  escalated boolean,
  calls_made integer,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by_name text,
  resolution_notes text,
  policy_name text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := coalesce((select time_zone from public.settings where id), 'UTC');
  v_ns time := coalesce(p_night_start, '22:00');
  v_ne time := coalesce(p_night_end, '06:00');
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_period not in ('all', 'night', 'day') then
    raise exception 'Unknown period' using errcode = '22023';
  end if;
  if v_ns = v_ne then
    raise exception 'Night start and end must differ' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'The end date is before the start date' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Choose at most a year' using errcode = '22023';
  end if;

  return query
  with c as (
    select w.*,
           coalesce(w.prompted_at, w.scheduled_at) as due,
           (coalesce(w.prompted_at, w.scheduled_at) at time zone v_tz) as local_ts
      from public.welfare_checks w
     where w.scheduled_at >= ((p_from - 1)::timestamp at time zone v_tz)
       and w.scheduled_at < ((p_to + 2)::timestamp at time zone v_tz)
       and (w.prompted_at is not null or w.responded_at is not null)
       and (p_officer_id is null or w.officer_id = p_officer_id)
       and (p_site_id is null or w.site_id = p_site_id)
       and (p_shift_id is null or w.shift_id = p_shift_id)
  ), n as (
    select c.*,
           case when v_ns < v_ne then c.local_ts::time >= v_ns and c.local_ts::time < v_ne
                else c.local_ts::time >= v_ns or c.local_ts::time < v_ne end as night
      from c
     where c.local_ts::date between p_from and p_to
  )
  select n.id, n.shift_id, n.officer_id, o.full_name, n.site_id, si.name, n.status,
         n.due, n.local_ts::date, n.local_ts::time, n.night,
         n.prompted_at, n.responded_at, n.response_seconds, n.response_flags,
         n.responded_at is not null,
         n.status in ('escalated', 'resolved')
           and (n.responded_at is null or 'after_escalation' = any (n.response_flags)),
         n.escalation_log @> '[{"step": "escalated"}]'::jsonb,
         n.calls_made, n.acknowledged_at, n.resolved_at, rb.full_name, n.resolution_notes,
         n.policy ->> 'name'
    from n
    left join public.profiles o on o.id = n.officer_id
    left join public.profiles rb on rb.id = n.resolved_by
    left join public.sites si on si.id = n.site_id
   where p_period = 'all' or (p_period = 'night') = n.night
   order by n.due;
end;
$$;

/** Totals per officer or per site over welfare_check_rows (same filters). */
create function public.welfare_report(
  p_from date,
  p_to date,
  p_group text default 'officer',
  p_period text default 'all',
  p_night_start time default '22:00',
  p_night_end time default '06:00',
  p_officer_id uuid default null,
  p_site_id uuid default null
)
returns table (
  group_id uuid,
  group_name text,
  prompted integer,
  answered integer,
  answered_late integer,
  missed integer,
  escalated integer,
  avg_response_seconds numeric,
  max_response_seconds integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_group not in ('officer', 'site') then
    raise exception 'Group by officer or site' using errcode = '22023';
  end if;
  return query
  select case when p_group = 'officer' then r.officer_id else r.site_id end,
         min(case when p_group = 'officer' then r.officer_name else r.site_name end),
         count(*)::int,
         count(*) filter (where r.answered)::int,
         count(*) filter (where r.answered and 'late' = any (r.response_flags))::int,
         count(*) filter (where r.missed)::int,
         count(*) filter (where r.escalated)::int,
         round(avg(r.response_seconds) filter (where r.answered), 1),
         max(r.response_seconds) filter (where r.answered)
    from public.welfare_check_rows(p_from, p_to, p_period, p_night_start, p_night_end,
                                   p_officer_id, p_site_id, null) r
   group by 1
   order by 2 nulls last;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS, grants, realtime, schedule
-- ---------------------------------------------------------------------------

alter table public.welfare_pauses enable row level security;

create policy "welfare_pauses: admins read"
  on public.welfare_pauses for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "welfare_pauses: supervisors read for their sites"
  on public.welfare_pauses for select to authenticated
  using ((select public.is_active_user())
         and (select public.auth_role()) = 'supervisor'
         and public.supervises_site(site_id));

grant select on public.welfare_pauses to authenticated;
grant all on public.welfare_pauses to service_role;

revoke execute on function public.welfare_shift_paused from public, anon, authenticated;
revoke execute on function public.welfare_end_pause from public, anon, authenticated;
revoke execute on function public.welfare_resume_due_pauses from public, anon, authenticated;
revoke execute on function public.welfare_pauses_on_shift_status from public, anon, authenticated;
revoke execute on function public.welfare_policy_for_site from public, anon, authenticated;
revoke execute on function public.welfare_schedule_next from public, anon, authenticated;

revoke execute on function public.acknowledge_welfare_check from public, anon;
revoke execute on function public.pause_welfare_checks from public, anon;
revoke execute on function public.resume_welfare_checks from public, anon;
revoke execute on function public.welfare_board from public, anon;
revoke execute on function public.welfare_check_rows from public, anon;
revoke execute on function public.welfare_report from public, anon;
grant execute on function public.acknowledge_welfare_check to authenticated;
grant execute on function public.pause_welfare_checks to authenticated;
grant execute on function public.resume_welfare_checks to authenticated;
grant execute on function public.welfare_board to authenticated;
grant execute on function public.welfare_check_rows to authenticated;
grant execute on function public.welfare_report to authenticated;

alter publication supabase_realtime add table public.device_heartbeats, public.welfare_pauses;

-- Same job name: replaces the phase 17 command. Due pauses end first, so the
-- next check is scheduled before the escalation pass.
select cron.schedule(
  'welfare-escalation', '* * * * *',
  'select public.welfare_resume_due_pauses(); select public.welfare_run_escalation();'
);
