-- Phase 10: management dashboard aggregates.
--
-- Three read-only functions for the admin console's home page. They are
-- SECURITY INVOKER: every table is read under the caller's own RLS, so the
-- numbers only ever cover rows the caller can see (when supervisors are later
-- scoped to their sites, the dashboard follows automatically). Only active
-- admins and supervisors may call them.
--
-- Days are in the company time zone (settings.time_zone). p_now exists so tests
-- can pin the clock; the console always uses the default.

-- ---------------------------------------------------------------------------
-- Today's numbers and the exceptions waiting for someone
-- ---------------------------------------------------------------------------

/**
 * One row. "Today" counts every non-cancelled shift that overlaps today, including
 * overnight shifts from yesterday, with the same rules as the console's live board
 * (/schedule/today), so each number matches the list it links to:
 *   covered   = clocked in (in progress or completed)
 *   late      = clocked in late, or started and not clocked in yet
 *   flagged   = any exception flag other than "late", or a refused attempt
 * Timesheets: pending entries in open pay periods (they block locking);
 * timesheets_pending_period_id is the earliest such period.
 * Licences: active officers with a licence already expired / expiring within 60 days.
 */
create function public.dashboard_summary(p_now timestamptz default now())
returns table (
  shifts_scheduled integer,
  shifts_covered integer,
  on_duty integer,
  late integer,
  late_arrivals integer,
  not_clocked_in integer,
  missed integer,
  flagged integer,
  incidents_awaiting_review integer,
  timesheets_pending integer,
  timesheets_pending_period_id uuid,
  licences_expired integer,
  licences_expiring_60 integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_zone text := (select s.time_zone from public.settings s where s.id);
  v_today date := (p_now at time zone v_zone)::date;
  v_day_start timestamptz := v_today::timestamp at time zone v_zone;
  v_day_end timestamptz := (v_today + 1)::timestamp at time zone v_zone;
begin
  if not coalesce(public.is_active_user() and public.auth_role() in ('admin', 'supervisor'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  with today_shifts as (
    select
      sh.status,
      sh.starts_at,
      exists (
        select 1 from public.attendance_events e
         where e.shift_id = sh.id and e.accepted and e.type = 'clock_in' and 'late' = any (e.flags)
      ) as late_in,
      exists (
        select 1 from public.attendance_events e
         where e.shift_id = sh.id
           and (not e.accepted or cardinality(array_remove(e.flags, 'late')) > 0)
      ) as has_flags
    from public.shifts sh
    where sh.status <> 'cancelled'
      and sh.starts_at < v_day_end
      and sh.ends_at > v_day_start
  ),
  today as (
    select
      count(*)::integer as scheduled,
      count(*) filter (where status in ('in_progress', 'completed'))::integer as covered,
      count(*) filter (where status = 'in_progress')::integer as on_duty,
      count(*) filter (where late_in)::integer as late_arrivals,
      count(*) filter (
        where status in ('scheduled', 'acknowledged') and starts_at <= p_now
      )::integer as not_in,
      count(*) filter (where status = 'missed')::integer as missed,
      count(*) filter (where has_flags)::integer as flagged
    from today_shifts
  ),
  pending as (
    select
      count(*)::integer as entries,
      (array_agg(p.id order by p.starts_on))[1] as first_period
    from public.timesheet_entries t
    join public.pay_periods p on t.work_date between p.starts_on and p.ends_on
    where p.status = 'open' and t.status = 'pending'
  ),
  officers as (
    select
      count(*) filter (
        where exists (
          select 1 from public.qualifications q
           where q.user_id = pr.id and q.expires_on < v_today
        )
      )::integer as expired,
      count(*) filter (
        where exists (
          select 1 from public.qualifications q
           where q.user_id = pr.id and q.expires_on between v_today and v_today + 60
        )
      )::integer as expiring
    from public.profiles pr
    where pr.role = 'officer' and pr.employment_status = 'active'
  )
  select
    today.scheduled,
    today.covered,
    today.on_duty,
    -- Same as the board's "late": arrived late, or should be here and isn't.
    (today.late_arrivals + today.not_in)::integer,
    today.late_arrivals,
    today.not_in,
    today.missed,
    today.flagged,
    (select count(*)::integer from public.incidents i
      where i.status in ('submitted', 'under_review')),
    pending.entries,
    pending.first_period,
    officers.expired,
    officers.expiring
  from today, pending, officers;
end;
$$;

comment on function public.dashboard_summary(timestamptz) is
  'Dashboard: today''s shift counts and exceptions. Security invoker (RLS applies); admins and supervisors only.';

-- ---------------------------------------------------------------------------
-- Attendance per day
-- ---------------------------------------------------------------------------

/**
 * One row per day for the last p_days days ending today (oldest first), by the
 * day each shift starts (like timesheets). on_time / late: accepted clock-in with
 * or without the "late" flag; missed: shift marked missed. Shifts nobody has
 * clocked in to yet (upcoming, or not in yet) are not counted.
 */
create function public.dashboard_attendance(p_days integer default 30, p_now timestamptz default now())
returns table (day date, on_time integer, late integer, missed integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_zone text := (select s.time_zone from public.settings s where s.id);
  v_today date := (p_now at time zone v_zone)::date;
  v_first date;
begin
  if not coalesce(public.is_active_user() and public.auth_role() in ('admin', 'supervisor'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 92 then
    raise exception 'p_days must be between 1 and 92' using errcode = '22023';
  end if;
  v_first := v_today - (p_days - 1);

  return query
  with outcomes as (
    select
      (sh.starts_at at time zone v_zone)::date as work_date,
      case
        when sh.status = 'missed' then 'missed'
        when ci.flags is null then null
        when 'late' = any (ci.flags) then 'late'
        else 'on_time'
      end as outcome
    from public.shifts sh
    left join lateral (
      select e.flags from public.attendance_events e
       where e.shift_id = sh.id and e.accepted and e.type = 'clock_in'
       order by e.recorded_at
       limit 1
    ) ci on true
    where sh.status <> 'cancelled'
      and sh.starts_at >= v_first::timestamp at time zone v_zone
      and sh.starts_at < (v_today + 1)::timestamp at time zone v_zone
  )
  select
    d::date,
    count(o.outcome) filter (where o.outcome = 'on_time')::integer,
    count(o.outcome) filter (where o.outcome = 'late')::integer,
    count(o.outcome) filter (where o.outcome = 'missed')::integer
  from generate_series(v_first, v_today, interval '1 day') as d
  left join outcomes o on o.work_date = d::date
  group by d
  order by d;
end;
$$;

comment on function public.dashboard_attendance(integer, timestamptz) is
  'Dashboard: clock-in outcomes per day (company time zone). Security invoker; admins and supervisors only.';

-- ---------------------------------------------------------------------------
-- Incidents per site
-- ---------------------------------------------------------------------------

/**
 * Incidents that happened (occurred_at) in the last p_days days ending today, per
 * site, most first. Every status counts: an incident happened whether or not it
 * has been reviewed. Sites with none are left out.
 */
create function public.dashboard_incidents_by_site(
  p_days integer default 30,
  p_now timestamptz default now()
)
returns table (site_id uuid, site_name text, incidents integer, high_or_critical integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_zone text := (select s.time_zone from public.settings s where s.id);
  v_today date := (p_now at time zone v_zone)::date;
begin
  if not coalesce(public.is_active_user() and public.auth_role() in ('admin', 'supervisor'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 92 then
    raise exception 'p_days must be between 1 and 92' using errcode = '22023';
  end if;

  return query
  select
    st.id,
    st.name,
    count(*)::integer,
    count(*) filter (where i.severity in ('high', 'critical'))::integer
  from public.incidents i
  join public.sites st on st.id = i.site_id
  where i.occurred_at >= (v_today - (p_days - 1))::timestamp at time zone v_zone
    and i.occurred_at < (v_today + 1)::timestamp at time zone v_zone
  group by st.id, st.name
  order by count(*) desc, st.name;
end;
$$;

comment on function public.dashboard_incidents_by_site(integer, timestamptz) is
  'Dashboard: incidents per site (company time zone). Security invoker; admins and supervisors only.';

revoke execute on function public.dashboard_summary(timestamptz) from public, anon;
revoke execute on function public.dashboard_attendance(integer, timestamptz) from public, anon;
revoke execute on function public.dashboard_incidents_by_site(integer, timestamptz) from public, anon;
grant execute on function public.dashboard_summary(timestamptz) to authenticated;
grant execute on function public.dashboard_attendance(integer, timestamptz) to authenticated;
grant execute on function public.dashboard_incidents_by_site(integer, timestamptz) to authenticated;
