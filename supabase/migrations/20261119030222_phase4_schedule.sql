-- Phase 4: scheduling console support.
--
-- 1. settings.time_zone: the company's time zone. The admin console uses it to
--    turn "Monday 07:00" into an instant, and to decide where a day or week
--    starts, so results don't depend on the server's own clock zone.
-- 2. Realtime: shifts and attendance_events are added to the
--    supabase_realtime publication for the live Today board. Realtime applies
--    each table's RLS select policies to every change it sends, so staff
--    receive all rows and officers only their own (the same as a select).

-- ---------------------------------------------------------------------------
-- Company time zone
-- ---------------------------------------------------------------------------

create function public.is_valid_time_zone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_name)
$$;

comment on function public.is_valid_time_zone is 'True when p_name is an IANA time zone Postgres knows.';

alter table public.settings
  add column time_zone text not null default 'Africa/Lagos'
    check (public.is_valid_time_zone(time_zone));

comment on column public.settings.time_zone is
  'IANA time zone for scheduling (day/week boundaries, times typed in the console).';

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.shifts, public.attendance_events;
