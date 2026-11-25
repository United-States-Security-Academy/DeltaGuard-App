-- Phase 10 tests: dashboard aggregates (dashboard_summary, dashboard_attendance,
-- dashboard_incidents_by_site). Run with: pnpm db:test
--
-- The clock is pinned with p_now = 2031-03-10 12:00Z (13:00 in Lagos, UTC+1), far
-- from any real data. Counts that aren't limited to a date window (incidents
-- waiting for review, pending timesheets, licences) are checked as the change
-- from a baseline taken before the fixtures, because the linked dev project may
-- already hold rows.
begin;

set local role postgres;
set local timezone = 'UTC';

create extension if not exists pgtap with schema extensions;

select set_config(
  'search_path',
  current_setting('search_path') || ', '
    || (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap'),
  true
);

select plan(36);

update public.settings set time_zone = 'Africa/Lagos';

create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
      'user_id', uid,
      'claims', jsonb_build_object('sub', uid, 'role', 'authenticated')
    )) -> 'claims')::text,
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- Users, then the baseline
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000a0001', 'p10.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P10 Officer A"}'),
  ('00000000-0000-0000-0000-0000000a0002', 'p10.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P10 Officer B"}'),
  ('00000000-0000-0000-0000-0000000a0003', 'p10.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P10 Officer C"}'),
  ('00000000-0000-0000-0000-0000000a0004', 'p10.d@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P10 Officer D"}'),
  ('00000000-0000-0000-0000-0000000a0005', 'p10.e@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P10 Officer E"}'),
  ('00000000-0000-0000-0000-0000000a0006', 'p10.f@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P10 Officer F"}'),
  ('00000000-0000-0000-0000-0000000a0007', 'p10.s@test.local', '{"role":"officer","employment_status":"suspended"}', '{"full_name":"P10 Suspended Officer"}'),
  ('00000000-0000-0000-0000-0000000a0008', 'p10.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P10 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000a0009', 'p10.sup2@test.local', '{"role":"supervisor","employment_status":"suspended"}', '{"full_name":"P10 Suspended Supervisor"}'),
  ('00000000-0000-0000-0000-0000000a000a', 'p10.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P10 Admin"}');

select pg_temp.login_as('00000000-0000-0000-0000-0000000a000a');
set local role authenticated;
create temp table p10_base as select * from public.dashboard_summary('2031-03-10 12:00:00+00');
set local role postgres;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000a00c1', 'P10 Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a00c1', 'P10 Site One'),
  ('00000000-0000-0000-0000-0000000a0052', '00000000-0000-0000-0000-0000000a00c1', 'P10 Site Two');
insert into public.site_assignments (site_id, officer_id)
select '00000000-0000-0000-0000-0000000a0051', id
  from auth.users where email in ('p10.a@test.local', 'p10.b@test.local', 'p10.c@test.local',
                                  'p10.d@test.local', 'p10.e@test.local', 'p10.f@test.local');

insert into public.pay_periods (id, starts_on, ends_on)
values ('00000000-0000-0000-0000-0000000a3001', '2031-03-01', '2031-03-15');

-- Today in Lagos (10 Mar 2031) runs from 9 Mar 23:00Z to 10 Mar 23:00Z.
insert into public.shifts (id, site_id, officer_id, starts_at, ends_at, status) values
  -- 1 A: on time, on duty
  ('00000000-0000-0000-0000-0000000a1001', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0001', '2031-03-10 07:00:00+00', '2031-03-10 15:00:00+00', 'in_progress'),
  -- 2 B: late, on duty
  ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0002', '2031-03-10 07:00:00+00', '2031-03-10 15:00:00+00', 'in_progress'),
  -- 3 C: finished, clock-in out of range (flagged, still on time)
  ('00000000-0000-0000-0000-0000000a1003', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0003', '2031-03-10 06:00:00+00', '2031-03-10 11:00:00+00', 'completed'),
  -- 4 D: started at 08:00Z, not clocked in yet
  ('00000000-0000-0000-0000-0000000a1004', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0004', '2031-03-10 08:00:00+00', '2031-03-10 16:00:00+00', 'scheduled'),
  -- 5 E: missed, with a refused attempt from another phone (flagged)
  ('00000000-0000-0000-0000-0000000a1005', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0005', '2031-03-10 05:00:00+00', '2031-03-10 09:00:00+00', 'missed'),
  -- 6 F: later today
  ('00000000-0000-0000-0000-0000000a1006', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0006', '2031-03-10 18:00:00+00', '2031-03-11 02:00:00+00', 'scheduled'),
  -- 7 B: cancelled (never counted)
  ('00000000-0000-0000-0000-0000000a1007', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0002', '2031-03-10 16:00:00+00', '2031-03-10 20:00:00+00', 'cancelled'),
  -- 8 A: overnight from yesterday (22:00 Lagos on 9 Mar), on time
  ('00000000-0000-0000-0000-0000000a1008', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0001', '2031-03-09 21:00:00+00', '2031-03-10 05:00:00+00', 'completed'),
  -- 9 C: missed on 9 Feb, the first day of the 30-day window
  ('00000000-0000-0000-0000-0000000a1009', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0003', '2031-02-09 08:00:00+00', '2031-02-09 12:00:00+00', 'missed'),
  -- 10 C: missed on 8 Feb, just outside the window
  ('00000000-0000-0000-0000-0000000a1010', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0003', '2031-02-08 08:00:00+00', '2031-02-08 12:00:00+00', 'missed');

insert into public.attendance_events (shift_id, officer_id, type, recorded_at, latitude, longitude, device_id, flags, accepted) values
  ('00000000-0000-0000-0000-0000000a1001', '00000000-0000-0000-0000-0000000a0001', 'clock_in',  '2031-03-10 07:02:00+00', 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-0000000a0002', 'clock_in',  '2031-03-10 07:30:00+00', 6.5, 3.4, 'p', '{late}', true),
  ('00000000-0000-0000-0000-0000000a1003', '00000000-0000-0000-0000-0000000a0003', 'clock_in',  '2031-03-10 06:00:00+00', 6.5, 3.4, 'p', '{out_of_range}', true),
  ('00000000-0000-0000-0000-0000000a1003', '00000000-0000-0000-0000-0000000a0003', 'clock_out', '2031-03-10 11:00:00+00', 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-0000000a1005', '00000000-0000-0000-0000-0000000a0005', 'clock_in',  '2031-03-10 05:01:00+00', 6.5, 3.4, 'other-phone', '{wrong_device}', false),
  ('00000000-0000-0000-0000-0000000a1008', '00000000-0000-0000-0000-0000000a0001', 'clock_in',  '2031-03-09 21:00:00+00', 6.5, 3.4, 'p', '{}', true);

insert into public.qualifications (user_id, type, expires_on) values
  ('00000000-0000-0000-0000-0000000a0001', 'Security licence', '2031-03-01'), -- expired
  ('00000000-0000-0000-0000-0000000a0002', 'Security licence', '2031-04-15'), -- expiring
  ('00000000-0000-0000-0000-0000000a0002', 'First aid',        '2031-03-10'), -- expires today: expiring, same officer
  ('00000000-0000-0000-0000-0000000a0003', 'Security licence', '2031-06-30'), -- fine
  ('00000000-0000-0000-0000-0000000a0004', 'Security licence', '2031-05-09'), -- exactly 60 days: expiring
  ('00000000-0000-0000-0000-0000000a0007', 'Security licence', '2031-03-20'); -- suspended: not counted

insert into public.incidents (id, site_id, officer_id, occurred_at, category, severity, description, status, reviewer_id, reviewed_at) values
  ('00000000-0000-0000-0000-0000000a2001', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0001', '2031-03-05 10:00:00+00', 'theft', 'high', 'P10 one', 'submitted', null, null),
  ('00000000-0000-0000-0000-0000000a2002', '00000000-0000-0000-0000-0000000a0051', '00000000-0000-0000-0000-0000000a0001', '2031-03-01 10:00:00+00', 'alarm', 'low', 'P10 two', 'approved', '00000000-0000-0000-0000-0000000a000a', '2031-03-02 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000a2003', '00000000-0000-0000-0000-0000000a0052', '00000000-0000-0000-0000-0000000a0002', '2031-02-20 10:00:00+00', 'fire', 'critical', 'P10 three', 'under_review', '00000000-0000-0000-0000-0000000a000a', null),
  ('00000000-0000-0000-0000-0000000a2004', '00000000-0000-0000-0000-0000000a0052', '00000000-0000-0000-0000-0000000a0002', '2031-01-01 10:00:00+00', 'other', 'low', 'P10 four (too old)', 'approved', '00000000-0000-0000-0000-0000000a000a', '2031-01-02 10:00:00+00'),
  -- 8 Feb 23:30Z is 9 Feb 00:30 in Lagos: inside the window
  ('00000000-0000-0000-0000-0000000a2005', '00000000-0000-0000-0000-0000000a0052', '00000000-0000-0000-0000-0000000a0003', '2031-02-08 23:30:00+00', 'trespass', 'medium', 'P10 five', 'submitted', null, null);

-- ---------------------------------------------------------------------------
-- Shape and access
-- ---------------------------------------------------------------------------

select ok(
  not (select bool_or(p.prosecdef) from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('dashboard_summary', 'dashboard_attendance', 'dashboard_incidents_by_site')),
  'the dashboard functions run as the caller (security invoker), so RLS applies'
);
select ok(not has_function_privilege('anon', 'public.dashboard_summary(timestamptz)', 'execute'),
  'anon cannot call dashboard_summary');
select ok(not has_function_privilege('anon', 'public.dashboard_attendance(integer, timestamptz)', 'execute'),
  'anon cannot call dashboard_attendance');
select ok(not has_function_privilege('anon', 'public.dashboard_incidents_by_site(integer, timestamptz)', 'execute'),
  'anon cannot call dashboard_incidents_by_site');

select pg_temp.login_as('00000000-0000-0000-0000-0000000a0001');
set local role authenticated;

select throws_ok($$ select * from public.dashboard_summary() $$, '42501', 'Not allowed',
  'an officer cannot read the dashboard summary');
select throws_ok($$ select * from public.dashboard_attendance() $$, '42501', 'Not allowed',
  'an officer cannot read dashboard attendance');
select throws_ok($$ select * from public.dashboard_incidents_by_site() $$, '42501', 'Not allowed',
  'an officer cannot read incidents by site');

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000a0009');
set local role authenticated;

select throws_ok($$ select * from public.dashboard_summary() $$, '42501', 'Not allowed',
  'a suspended supervisor cannot read the dashboard');

set local role postgres;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a000a","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$ select * from public.dashboard_summary() $$, '42501', 'Not allowed',
  'a token without the user_role claim is refused');

-- ---------------------------------------------------------------------------
-- Summary (admin)
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000a000a');
set local role authenticated;
create temp table p10_admin as select * from public.dashboard_summary('2031-03-10 12:00:00+00');
set local role postgres;

create function pg_temp.delta(col text) returns integer language plpgsql as $$
declare v integer;
begin
  execute format('select (select %1$I from p10_admin) - (select %1$I from p10_base)', col) into v;
  return v;
end;
$$;

select is(pg_temp.delta('shifts_scheduled'), 7,
  'scheduled: every shift touching today, including last night''s, not the cancelled one');
select is(pg_temp.delta('shifts_covered'), 4, 'covered: shifts with a clock-in (on duty or finished)');
select is(pg_temp.delta('on_duty'), 2, 'on duty now: shifts in progress');
select is(pg_temp.delta('late_arrivals'), 1, 'late arrivals: clocked in with the late flag');
select is(pg_temp.delta('not_clocked_in'), 1, 'not clocked in: started, no clock-in, not yet missed');
select is(pg_temp.delta('late'), 2, 'late (as on the live board) = late arrivals + not clocked in');
select is(pg_temp.delta('missed'), 1, 'missed today');
select is(pg_temp.delta('flagged'), 2, 'flagged: an out-of-range clock-in and a refused attempt');
select is(pg_temp.delta('incidents_awaiting_review'), 3,
  'incidents awaiting review: submitted and under review, any date');
select is(pg_temp.delta('licences_expired'), 1, 'one active officer has an expired licence');
select is(pg_temp.delta('licences_expiring_60'), 2,
  'two active officers have a licence expiring within 60 days (today and day 60 included; suspended excluded)');

select ok(
  (select count(*) from public.timesheet_entries
    where work_date between '2031-03-01' and '2031-03-15' and status = 'pending') >= 4,
  'the clock-ins created pending timesheet entries in the open pay period'
);
select is(
  pg_temp.delta('timesheets_pending'),
  (select count(*)::integer from public.timesheet_entries
    where work_date between '2031-03-01' and '2031-03-15' and status = 'pending'),
  'timesheets pending: counts the pending entries in the open pay period'
);

-- A supervisor sees the same company-wide numbers (no site scoping yet).
select pg_temp.login_as('00000000-0000-0000-0000-0000000a0008');
set local role authenticated;
create temp table p10_sup as select * from public.dashboard_summary('2031-03-10 12:00:00+00');
set local role postgres;

select ok(
  (select row(s.*)::text from p10_sup s) = (select row(a.*)::text from p10_admin a),
  'a supervisor gets the same summary as an admin'
);

-- ---------------------------------------------------------------------------
-- Attendance per day
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000a000a');
set local role authenticated;

select is(
  (select count(*)::integer from public.dashboard_attendance(30, '2031-03-10 12:00:00+00')),
  30, 'one row per day for 30 days'
);
select is(
  (select min(day) from public.dashboard_attendance(30, '2031-03-10 12:00:00+00')),
  '2031-02-09'::date, 'the window starts 29 days before today'
);
select results_eq(
  $$ select on_time, late, missed from public.dashboard_attendance(30, '2031-03-10 12:00:00+00')
      where day = '2031-03-10' $$,
  $$ values (2, 1, 1) $$,
  'today: two on time (an out-of-range clock-in still counts), one late, one missed; not-yet-in and later shifts not counted'
);
select results_eq(
  $$ select on_time, late, missed from public.dashboard_attendance(30, '2031-03-10 12:00:00+00')
      where day = '2031-03-09' $$,
  $$ values (1, 0, 0) $$,
  'a night shift counts on the day it starts (company time zone)'
);
select results_eq(
  $$ select on_time, late, missed from public.dashboard_attendance(30, '2031-03-10 12:00:00+00')
      where day = '2031-02-09' $$,
  $$ values (0, 0, 1) $$,
  'the first day of the window is included'
);
select results_eq(
  $$ select sum(on_time)::integer, sum(late)::integer, sum(missed)::integer
       from public.dashboard_attendance(30, '2031-03-10 12:00:00+00') $$,
  $$ values (3, 1, 2) $$,
  'the shift the day before the window is left out'
);
select is(
  (select count(*)::integer from public.dashboard_attendance(7, '2031-03-10 12:00:00+00')),
  7, 'p_days sets the window length'
);
select throws_ok(
  $$ select * from public.dashboard_attendance(0) $$, '22023', null,
  'p_days must be at least 1'
);
select throws_ok(
  $$ select * from public.dashboard_attendance(93) $$, '22023', null,
  'p_days is capped at 92'
);

-- ---------------------------------------------------------------------------
-- Incidents by site
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select site_name, incidents, high_or_critical
       from public.dashboard_incidents_by_site(30, '2031-03-10 12:00:00+00')
      where site_name like 'P10 %' $$,
  $$ values ('P10 Site One'::text, 2, 1), ('P10 Site Two'::text, 2, 1) $$,
  'incidents per site in the window, any status, ties ordered by name'
);
select is(
  (select incidents from public.dashboard_incidents_by_site(10, '2031-03-10 12:00:00+00')
    where site_name = 'P10 Site Two'),
  null::integer,
  'a site with no incidents in a shorter window is left out'
);
select is(
  (select incidents from public.dashboard_incidents_by_site(10, '2031-03-10 12:00:00+00')
    where site_name = 'P10 Site One'),
  2, 'a shorter window still includes recent incidents'
);
select throws_ok(
  $$ select * from public.dashboard_incidents_by_site(0) $$, '22023', null,
  'incidents by site: p_days must be at least 1'
);

select * from finish();
rollback;
