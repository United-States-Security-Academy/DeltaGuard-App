-- Phase 8: timesheets, corrections, approval and pay periods.
--
-- timesheet_entries      one row per shift that was worked (accepted clock-in)
--                        or missed. Kept up to date from attendance_events by
--                        trigger. Holds the ORIGINAL times (from attendance,
--                        never edited) and optional CORRECTED times (set by a
--                        supervisor); the effective time is corrected ?? original.
-- timesheet_corrections  audit log of every correction: original, previous and
--                        new times, reason, who and when. Append-only.
-- pay_periods            date ranges (company time zone); open -> locked.
--
-- attendance_events is never changed by anything here.
--
-- Dates: an entry's work_date is the day its SHIFT STARTS in the company time
-- zone (settings.time_zone), the same rule as the schedule. A night shift
-- 22:00-06:00 is one entry on the day it starts, with all its minutes, and
-- belongs to the pay period containing that day.
--
-- Times: for a clock event sent late from the offline queue ('delayed'), the
-- phone's time (device_time) is when it happened; recorded_at is only when it
-- reached the server. Timesheets use device_time for those.
--
-- Workflow:
--   correct_timesheet_entry()     admin/supervisor, reason required; resets approval
--   approve_timesheet_entries()   admin/supervisor, bulk; not your own entries;
--                                 an entry with a clock-in but no clock-out
--                                 must be corrected first
--   lock_pay_period()             admin; period over and every entry approved.
--                                 After that nothing in the period can change:
--                                 a trigger refuses any change to its entries,
--                                 and the period itself can't be edited or
--                                 deleted. Attendance that arrives later is
--                                 still recorded, but doesn't reach the
--                                 locked timesheet.
--
-- Access summary (every policy also requires is_active_user()):
--   admin       reads everything; creates/deletes open pay periods; locks
--   supervisor  reads everything; corrects and approves through the functions
--   officer     reads their own entries and the corrections to them

-- ---------------------------------------------------------------------------
-- pay_periods
-- ---------------------------------------------------------------------------

create type public.pay_period_status as enum ('open', 'locked');

create table public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null, -- inclusive
  status public.pay_period_status not null default 'open',
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 62),
  constraint pay_periods_no_overlap exclude using gist (
    daterange(starts_on, ends_on, '[]') with &&
  )
);

comment on table public.pay_periods is
  'Payroll periods (dates in the company time zone, inclusive). Locked periods are frozen.';

create function public.pay_periods_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      new.status := 'open';
      new.locked_at := null;
      new.locked_by := null;
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    return new;
  end if;
  if old.status = 'locked' then
    raise exception 'This pay period is locked' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger pay_periods_guard
  before insert or update or delete on public.pay_periods
  for each row execute function public.pay_periods_guard();

/** True when `p_date` is inside a locked pay period. */
create function public.is_locked_date(p_date date)
returns boolean
language sql
stable
security definer -- used by triggers whatever the caller can read
set search_path = ''
as $$
  select exists (
    select 1 from public.pay_periods p
     where p.status = 'locked' and p_date between p.starts_on and p.ends_on
  )
$$;

revoke execute on function public.is_locked_date from public, anon;
grant execute on function public.is_locked_date to authenticated;

-- ---------------------------------------------------------------------------
-- timesheet_entries
-- ---------------------------------------------------------------------------

create type public.timesheet_status as enum ('pending', 'approved');

create table public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references public.shifts (id) on delete restrict,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  work_date date not null, -- day the shift starts, company time zone
  -- From attendance_events (accepted only). Never edited by hand.
  original_clock_in_at timestamptz,
  original_clock_out_at timestamptz,
  -- Set only by correct_timesheet_entry().
  corrected_clock_in_at timestamptz,
  corrected_clock_out_at timestamptz,
  clock_in_at timestamptz generated always as (coalesce(corrected_clock_in_at, original_clock_in_at)) stored,
  clock_out_at timestamptz generated always as (coalesce(corrected_clock_out_at, original_clock_out_at)) stored,
  worked_minutes integer generated always as (
    case
      when coalesce(corrected_clock_in_at, original_clock_in_at) is not null
       and coalesce(corrected_clock_out_at, original_clock_out_at) is not null
      then floor(extract(epoch from (
        coalesce(corrected_clock_out_at, original_clock_out_at)
        - coalesce(corrected_clock_in_at, original_clock_in_at)
      )) / 60)::integer
    end
  ) stored,
  -- Attendance flags of the clock-in and clock-out (late, out_of_range…).
  flags text[] not null default '{}',
  status public.timesheet_status not null default 'pending',
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (corrected_clock_out_at is null or corrected_clock_in_at is null
         or corrected_clock_out_at > corrected_clock_in_at)
);

comment on table public.timesheet_entries is
  'One per worked or missed shift. Original times come from attendance; corrections are separate and audited.';

create index timesheet_entries_date_idx on public.timesheet_entries (work_date);
create index timesheet_entries_officer_idx on public.timesheet_entries (officer_id, work_date);

create trigger timesheet_entries_set_updated_at
  before update on public.timesheet_entries
  for each row execute function public.set_updated_at();

-- Nothing in a locked pay period can change, whoever tries.
create function public.timesheet_entries_guard_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_locked_date(case when tg_op = 'INSERT' then new.work_date else old.work_date end)
     or (tg_op = 'UPDATE' and public.is_locked_date(new.work_date))
  then
    raise exception 'This pay period is locked' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger timesheet_entries_guard_locked
  before insert or update or delete on public.timesheet_entries
  for each row execute function public.timesheet_entries_guard_locked();

/** The work date of a shift: the day it starts in the company time zone. */
create function public.shift_work_date(p_starts_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_starts_at at time zone (select s.time_zone from public.settings s where s.id))::date
$$;

-- From attendance: keep the entry's original times and flags up to date.
create function public.timesheet_from_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_date date;
  -- When it happened: the phone's time for events sent late from the queue.
  v_at timestamptz := case
    when 'delayed' = any(new.flags) and new.device_time is not null then new.device_time
    else new.recorded_at
  end;
begin
  if not new.accepted then
    return null;
  end if;
  select * into v_shift from public.shifts where id = new.shift_id;
  v_date := public.shift_work_date(v_shift.starts_at);
  -- Locked: the attendance is kept, the payroll isn't touched.
  if public.is_locked_date(v_date) then
    return null;
  end if;

  insert into public.timesheet_entries (
    shift_id, officer_id, site_id, work_date, original_clock_in_at, original_clock_out_at, flags
  ) values (
    v_shift.id, v_shift.officer_id, v_shift.site_id, v_date,
    case when new.type = 'clock_in' then v_at end,
    case when new.type = 'clock_out' then v_at end,
    new.flags
  )
  on conflict (shift_id) do update
    set original_clock_in_at = coalesce(excluded.original_clock_in_at, timesheet_entries.original_clock_in_at),
        original_clock_out_at = coalesce(excluded.original_clock_out_at, timesheet_entries.original_clock_out_at),
        flags = array(
          select distinct f from unnest(timesheet_entries.flags || excluded.flags) as f order by f
        ),
        -- New attendance means the approved figures may be out of date.
        status = 'pending',
        approved_by = null,
        approved_at = null;
  return null;
end;
$$;

create trigger attendance_events_to_timesheet
  after insert on public.attendance_events
  for each row execute function public.timesheet_from_attendance();

-- A missed shift gets an entry with no times, so payroll sees it.
create function public.timesheet_from_missed_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := public.shift_work_date(new.starts_at);
begin
  if new.status = 'missed' and old.status is distinct from 'missed'
     and not public.is_locked_date(v_date)
  then
    insert into public.timesheet_entries (shift_id, officer_id, site_id, work_date)
    values (new.id, new.officer_id, new.site_id, v_date)
    on conflict (shift_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger shifts_missed_to_timesheet
  after update of status on public.shifts
  for each row execute function public.timesheet_from_missed_shift();

-- Existing attendance and missed shifts.
insert into public.timesheet_entries (
  shift_id, officer_id, site_id, work_date, original_clock_in_at, original_clock_out_at, flags
)
select
  s.id, s.officer_id, s.site_id, public.shift_work_date(s.starts_at),
  (select case when 'delayed' = any(e.flags) and e.device_time is not null then e.device_time else e.recorded_at end
     from public.attendance_events e
    where e.shift_id = s.id and e.type = 'clock_in' and e.accepted),
  (select case when 'delayed' = any(e.flags) and e.device_time is not null then e.device_time else e.recorded_at end
     from public.attendance_events e
    where e.shift_id = s.id and e.type = 'clock_out' and e.accepted),
  coalesce((select array(select distinct f from public.attendance_events e, unnest(e.flags) as f
                          where e.shift_id = s.id and e.accepted order by f)), '{}')
from public.shifts s
where s.status = 'missed'
   or exists (select 1 from public.attendance_events e where e.shift_id = s.id and e.accepted);

-- ---------------------------------------------------------------------------
-- timesheet_corrections (audit)
-- ---------------------------------------------------------------------------

create table public.timesheet_corrections (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.timesheet_entries (id) on delete restrict,
  -- From attendance, for reference (what the officer's phone recorded).
  original_clock_in_at timestamptz,
  original_clock_out_at timestamptz,
  -- The effective times just before this correction, and after it.
  previous_clock_in_at timestamptz,
  previous_clock_out_at timestamptz,
  new_clock_in_at timestamptz not null,
  new_clock_out_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  corrected_by uuid references public.profiles (id) on delete set null,
  corrected_at timestamptz not null default now()
);

comment on table public.timesheet_corrections is
  'Audit log of timesheet corrections. Append-only, written only by correct_timesheet_entry().';

create index timesheet_corrections_entry_idx on public.timesheet_corrections (entry_id, corrected_at);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

create function public.correct_timesheet_entry(
  p_entry_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_reason text
)
returns public.timesheet_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_entry public.timesheet_entries;
  v_shift public.shifts;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null or not public.is_active_user()
     or coalesce(public.auth_role(), '') not in ('admin', 'supervisor') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_entry from public.timesheet_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Timesheet entry not found' using errcode = '42501';
  end if;
  if v_entry.officer_id = v_uid then
    raise exception 'You can''t correct your own timesheet' using errcode = '42501';
  end if;
  if public.is_locked_date(v_entry.work_date) then
    raise exception 'This pay period is locked' using errcode = 'P0001';
  end if;

  if char_length(v_reason) not between 3 and 1000 then
    raise exception 'Give a reason for the correction' using errcode = '22023';
  end if;
  if p_clock_in_at is null or p_clock_out_at is null then
    raise exception 'Enter both the clock-in and the clock-out time' using errcode = '22023';
  end if;
  if p_clock_out_at <= p_clock_in_at then
    raise exception 'The clock-out must be after the clock-in' using errcode = '22023';
  end if;
  if p_clock_out_at - p_clock_in_at > interval '24 hours' then
    raise exception 'A shift can be at most 24 hours long' using errcode = '22023';
  end if;
  select * into v_shift from public.shifts where id = v_entry.shift_id;
  if p_clock_in_at < v_shift.starts_at - interval '12 hours'
     or p_clock_out_at > v_shift.ends_at + interval '12 hours' then
    raise exception 'The times must be within 12 hours of the scheduled shift' using errcode = '22023';
  end if;

  insert into public.timesheet_corrections (
    entry_id, original_clock_in_at, original_clock_out_at, previous_clock_in_at,
    previous_clock_out_at, new_clock_in_at, new_clock_out_at, reason, corrected_by
  ) values (
    v_entry.id, v_entry.original_clock_in_at, v_entry.original_clock_out_at, v_entry.clock_in_at,
    v_entry.clock_out_at, p_clock_in_at, p_clock_out_at, v_reason, v_uid
  );

  update public.timesheet_entries
     set corrected_clock_in_at = p_clock_in_at,
         corrected_clock_out_at = p_clock_out_at,
         status = 'pending',
         approved_by = null,
         approved_at = null
   where id = v_entry.id
  returning * into v_entry;

  return v_entry;
end;
$$;

comment on function public.correct_timesheet_entry is
  'Admin/supervisor sets corrected times with a reason (audited). Resets approval. Not in locked periods.';

create function public.approve_timesheet_entries(p_entry_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null or not public.is_active_user()
     or coalesce(public.auth_role(), '') not in ('admin', 'supervisor') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  -- Entries that can't be approved are skipped: already approved, your own,
  -- in a locked period, or clocked in without a clock-out (correct it first).
  update public.timesheet_entries t
     set status = 'approved', approved_by = v_uid, approved_at = now()
   where t.id = any(p_entry_ids)
     and t.status = 'pending'
     and t.officer_id <> v_uid
     and not (t.clock_in_at is not null and t.clock_out_at is null)
     and not public.is_locked_date(t.work_date);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.approve_timesheet_entries is
  'Admin/supervisor approves entries in bulk. Returns how many were approved; the rest were skipped.';

create function public.lock_pay_period(p_period_id uuid)
returns public.pay_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_period public.pay_periods;
  v_today date := (now() at time zone (select s.time_zone from public.settings s where s.id))::date;
  v_pending integer;
begin
  if v_uid is null or not public.is_active_user() or coalesce(public.auth_role(), '') <> 'admin' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_period from public.pay_periods where id = p_period_id for update;
  if not found then
    raise exception 'Pay period not found' using errcode = '42501';
  end if;
  if v_period.status = 'locked' then
    return v_period;
  end if;
  if v_period.ends_on >= v_today then
    raise exception 'This pay period hasn''t ended yet' using errcode = 'P0001';
  end if;

  select count(*) into v_pending from public.timesheet_entries t
   where t.work_date between v_period.starts_on and v_period.ends_on and t.status <> 'approved';
  if v_pending > 0 then
    raise exception '% timesheet % still need% approval', v_pending,
      case when v_pending = 1 then 'entry' else 'entries' end,
      case when v_pending = 1 then 's' else '' end
      using errcode = 'P0001';
  end if;
  -- Shifts nobody clocked in to that the missed-shift job hasn't caught yet
  -- (a forgotten clock-out is already covered: its entry can't be approved
  -- until a supervisor corrects it).
  if exists (
    select 1 from public.shifts s
     where public.shift_work_date(s.starts_at) between v_period.starts_on and v_period.ends_on
       and s.status in ('scheduled', 'acknowledged')
  ) then
    raise exception 'Some shifts in this period are not marked missed yet. Try again in a few minutes'
      using errcode = 'P0001';
  end if;

  update public.pay_periods
     set status = 'locked', locked_at = now(), locked_by = v_uid
   where id = v_period.id
  returning * into v_period;
  return v_period;
end;
$$;

comment on function public.lock_pay_period is
  'Admin locks a finished pay period whose entries are all approved. Irreversible.';

revoke execute on function public.correct_timesheet_entry from public, anon;
revoke execute on function public.approve_timesheet_entries from public, anon;
revoke execute on function public.lock_pay_period from public, anon;
grant execute on function public.correct_timesheet_entry to authenticated;
grant execute on function public.approve_timesheet_entries to authenticated;
grant execute on function public.lock_pay_period to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.pay_periods enable row level security;
alter table public.timesheet_entries enable row level security;
alter table public.timesheet_corrections enable row level security;

revoke all on public.pay_periods, public.timesheet_entries, public.timesheet_corrections
  from anon, authenticated;
grant select, insert, delete on public.pay_periods to authenticated;
grant select on public.timesheet_entries, public.timesheet_corrections to authenticated;
grant all on public.pay_periods, public.timesheet_entries, public.timesheet_corrections
  to service_role;

create policy "pay_periods: active users read"
  on public.pay_periods for select to authenticated
  using ((select public.is_active_user()));

create policy "pay_periods: admins create"
  on public.pay_periods for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- The guard trigger refuses deleting a locked period.
create policy "pay_periods: admins delete"
  on public.pay_periods for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "timesheet_entries: officers read their own"
  on public.timesheet_entries for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "timesheet_entries: staff read all"
  on public.timesheet_entries for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "timesheet_corrections: officers read their own"
  on public.timesheet_corrections for select to authenticated
  using (
    (select public.is_active_user())
    and exists (
      select 1 from public.timesheet_entries t
       where t.id = timesheet_corrections.entry_id and t.officer_id = (select auth.uid())
    )
  );

create policy "timesheet_corrections: staff read all"
  on public.timesheet_corrections for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));
