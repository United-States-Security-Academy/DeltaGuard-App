-- Phase 3 tests: shifts, clock_event(), attendance RLS, settings and the
-- missed-shift job. Run with: pnpm db:test
--
-- now() is fixed for the whole transaction, so shift times below are set
-- relative to it and every result is deterministic.
begin;

set local role postgres;

create extension if not exists pgtap with schema extensions;

select set_config(
  'search_path',
  current_setting('search_path') || ', '
    || (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap'),
  true
);

select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- Site S is at 6.5, 3.4 with a 150 m radius. Officers A, B, C and the
-- suspended officer D are assigned to it; nobody is assigned to site T.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000003a1', 'p3.officer.a@test.local', '{"role":"officer","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000003a2', 'p3.officer.b@test.local', '{"role":"officer","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000003a3', 'p3.officer.c@test.local', '{"role":"officer","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000003b1', 'p3.supervisor@test.local', '{"role":"supervisor","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000003c1', 'p3.admin@test.local', '{"role":"admin","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000003d1', 'p3.suspended@test.local', '{"role":"officer","employment_status":"suspended"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000003a1', 'phone-a', 'ios'),
  ('00000000-0000-0000-0000-0000000003a2', 'phone-b', 'android'),
  ('00000000-0000-0000-0000-0000000003d1', 'phone-d', 'android');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000003c001', 'P3 Client');

insert into public.sites (id, client_id, name, latitude, longitude, clock_in_radius_m) values
  ('00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-00000003c001', 'P3 Site S', 6.5, 3.4, 150),
  ('00000000-0000-0000-0000-00000003502e', '00000000-0000-0000-0000-00000003c001', 'P3 Site T', 6.6, 3.5, 150);

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a1'),
  ('00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a2'),
  ('00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a3'),
  ('00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003d1');

-- Shift ids: 5h + officer letter + number.
insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  -- A0: ended 3 hours ago, nobody clocked in -> missed by the job
  ('00000000-0000-0000-0000-000000005a00', '00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a1', now() - interval '4 hours', now() - interval '3 hours'),
  -- A1: started 30 min ago -> late clock-in
  ('00000000-0000-0000-0000-000000005a01', '00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a1', now() - interval '30 minutes', now() + interval '60 minutes'),
  -- A2: starts in 60 min, right when A1 ends -> early clock-in allowed (window 60 min)
  ('00000000-0000-0000-0000-000000005a02', '00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a1', now() + interval '60 minutes', now() + interval '3 hours'),
  -- A3: starts in 5 hours -> too early
  ('00000000-0000-0000-0000-000000005a03', '00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a1', now() + interval '5 hours', now() + interval '7 hours'),
  -- B0: Officer B's shift, started 15 min ago
  ('00000000-0000-0000-0000-000000005b00', '00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a2', now() - interval '15 minutes', now() + interval '2 hours'),
  -- C0: started 5 min ago, still within the 10 min grace -> not missed yet
  ('00000000-0000-0000-0000-000000005c00', '00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a3', now() - interval '5 minutes', now() + interval '2 hours'),
  -- D0: suspended officer's shift
  ('00000000-0000-0000-0000-000000005d00', '00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003d1', now() - interval '5 minutes', now() + interval '2 hours');

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
-- Schema
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has RLS enabled'
);

select is(
  (select late_grace_minutes from public.settings),
  10,
  'late grace period defaults to 10 minutes'
);

select is(
  (select count(*)::int from cron.job where jobname = 'mark-missed-shifts' and schedule = '*/5 * * * *'),
  1,
  'missed-shift job is scheduled every 5 minutes'
);

select ok(
  public.distance_m(0, 0, 1, 0) between 111000 and 111400,
  'distance_m: one degree of latitude is about 111 km'
);

-- ---------------------------------------------------------------------------
-- Officer B clocks in (gives B an attendance row for the visibility tests)
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000003a2');
set local role authenticated;

select lives_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005b00', 'clock_in', 6.5, 3.4, 10, false, 'phone-b') $$,
  'officer B can clock in to their own shift'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Officer A
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000003a1');
set local role authenticated;

select throws_ok(
  $$ insert into public.attendance_events (shift_id, officer_id, type, latitude, longitude, device_id)
     values ('00000000-0000-0000-0000-000000005a01', '00000000-0000-0000-0000-0000000003a1', 'clock_in', 6.5, 3.4, 'phone-a') $$,
  '42501',
  null,
  'officer cannot insert attendance directly'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005b00', 'clock_in', 6.5, 3.4, 10, false, 'phone-a') $$,
  '42501',
  'Shift not found',
  'officer cannot clock in to someone else''s shift'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005fff', 'clock_in', 6.5, 3.4, 10, false, 'phone-a') $$,
  '42501',
  'Shift not found',
  'officer cannot clock in to a shift that does not exist'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005a01', 'clock_in', null, null, 10, false, 'phone-a') $$,
  '22023',
  null,
  'clocking in needs a location'
);

-- Wrong phone: recorded, flagged, not accepted, shift unchanged.
select is(
  (public.clock_event('00000000-0000-0000-0000-000000005a02', 'clock_in', 6.5, 3.4, 10, false, 'someone-elses-phone')).flags,
  array['wrong_device']::text[],
  'clocking in from an unregistered phone is flagged wrong_device'
);

select is(
  (select accepted from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-000000005a02' and device_id = 'someone-elses-phone'),
  false,
  'the wrong-phone attempt is not accepted'
);

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-000000005a02'),
  'scheduled',
  'the wrong-phone attempt does not change the shift'
);

-- Late clock-in at the site, with a fake phone clock.
select is(
  (public.clock_event('00000000-0000-0000-0000-000000005a01', 'clock_in', 6.5003, 3.4, 12, false, 'phone-a', '2000-01-01 00:00:00+00')).flags,
  array['late']::text[],
  'clocking in 30 minutes after the start (grace 10) is flagged late, nothing else'
);

select is(
  (select recorded_at from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-000000005a01' and type = 'clock_in'),
  now(),
  'recorded_at is the server''s time'
);

select is(
  (select device_time from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-000000005a01' and type = 'clock_in'),
  '2000-01-01 00:00:00+00'::timestamptz,
  'the phone''s own clock is kept separately in device_time'
);

select ok(
  (select distance_from_site_m between 25 and 40 from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-000000005a01' and type = 'clock_in'),
  'distance to the site is computed (about 33 m)'
);

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-000000005a01'),
  'in_progress',
  'clocking in moves the shift to in_progress'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005a01', 'clock_in', 6.5, 3.4, 10, false, 'phone-a') $$,
  '23505',
  'Already clocked in for this shift',
  'officer cannot clock in twice'
);

-- Early, 1 km away, mock location and poor accuracy.
select is(
  (public.clock_event('00000000-0000-0000-0000-000000005a02', 'clock_in', 6.509, 3.4, 500, true, 'phone-a')).flags,
  array['out_of_range', 'mock_location', 'low_accuracy']::text[],
  'far away, mock location and 500 m accuracy are all flagged (early is not late)'
);

select ok(
  (select distance_from_site_m between 990 and 1010 from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-000000005a02' and type = 'clock_in' and accepted),
  'distance for a clock-in 1 km away is about 1000 m'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005a03', 'clock_in', 6.5, 3.4, 10, false, 'phone-a') $$,
  'P0001',
  null,
  'officer cannot clock in hours before the shift'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005a03', 'clock_out', 6.5, 3.4, 10, false, 'phone-a') $$,
  'P0001',
  'You need to clock in before you can clock out',
  'officer cannot clock out without clocking in'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005a00', 'clock_in', 6.5, 3.4, 10, false, 'phone-a') $$,
  'P0001',
  'This shift has already ended',
  'officer cannot clock in to a shift that has ended'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-000000005a01', 'clock_out', 6.5, 3.4, 10, false, 'phone-a')).flags,
  array['early_leave']::text[],
  'clocking out before the shift ends is flagged early_leave'
);

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-000000005a01'),
  'completed',
  'clocking out completes the shift'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005a01', 'clock_in', 6.5, 3.4, 10, false, 'phone-a') $$,
  'P0001',
  'This shift is completed',
  'a completed shift accepts no more events'
);

select throws_ok(
  $$ update public.attendance_events set flags = '{}' where officer_id = '00000000-0000-0000-0000-0000000003a1' $$,
  '42501',
  null,
  'officer cannot edit attendance (removing flags)'
);

select is(
  (select count(*)::int from public.shifts where officer_id <> '00000000-0000-0000-0000-0000000003a1'),
  0,
  'officer sees only their own shifts'
);

select is(
  (select count(*)::int from public.attendance_events where officer_id <> '00000000-0000-0000-0000-0000000003a1'),
  0,
  'officer sees only their own attendance'
);

select throws_ok(
  $$ select public.mark_missed_shifts() $$,
  '42501',
  null,
  'officer cannot run the missed-shift job'
);

update public.shifts set status = 'completed' where id = '00000000-0000-0000-0000-000000005a03';
update public.settings set late_grace_minutes = 240;

set local role postgres;

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-000000005a03'),
  'scheduled',
  'officer cannot change a shift''s status directly'
);

select is(
  (select late_grace_minutes from public.settings),
  10,
  'officer cannot change settings'
);

-- ---------------------------------------------------------------------------
-- Suspended officer
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000003d1');
set local role authenticated;

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005d00', 'clock_in', 6.5, 3.4, 10, false, 'phone-d') $$,
  '42501',
  'Not allowed',
  'suspended officer cannot clock in'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Supervisor
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000003b1');
set local role authenticated;

select is(
  (select count(*)::int from public.shifts where id::text like '00000000-0000-0000-0000-000000005%'),
  7,
  'supervisor reads every shift'
);

select is(
  (select count(distinct officer_id)::int from public.attendance_events
    where officer_id in ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000003a2')),
  2,
  'supervisor reads every officer''s attendance'
);

select lives_ok(
  $$ insert into public.shifts (id, site_id, officer_id, starts_at, ends_at, created_by)
     values ('00000000-0000-0000-0000-000000005b01', '00000000-0000-0000-0000-00000003501e',
             '00000000-0000-0000-0000-0000000003a2', now() + interval '1 day', now() + interval '1 day 8 hours',
             '00000000-0000-0000-0000-0000000003c1') $$,
  'supervisor can schedule a shift'
);

select throws_ok(
  $$ insert into public.shifts (site_id, officer_id, starts_at, ends_at)
     values ('00000000-0000-0000-0000-00000003501e', '00000000-0000-0000-0000-0000000003a1',
             now() + interval '5 hours 30 minutes', now() + interval '9 hours') $$,
  '23P01',
  null,
  'an officer cannot be given overlapping shifts'
);

select throws_ok(
  $$ insert into public.shifts (site_id, officer_id, starts_at, ends_at)
     values ('00000000-0000-0000-0000-00000003502e', '00000000-0000-0000-0000-0000000003a2',
             now() + interval '2 days', now() + interval '2 days 8 hours') $$,
  '23514',
  null,
  'an officer can only be scheduled at a site they are assigned to'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-000000005c00', 'clock_in', 6.5, 3.4, 10, false, 'phone-c') $$,
  '42501',
  'Shift not found',
  'supervisor cannot clock in for an officer'
);

delete from public.shifts where id = '00000000-0000-0000-0000-000000005b01';
update public.settings set late_grace_minutes = 240;

set local role postgres;

select is(
  (select created_by from public.shifts where id = '00000000-0000-0000-0000-000000005b01'),
  '00000000-0000-0000-0000-0000000003b1'::uuid,
  'created_by is set to the real creator, not what the client sent'
);

select is(
  (select count(*)::int from public.shifts where id = '00000000-0000-0000-0000-000000005b01'),
  1,
  'supervisor cannot delete shifts'
);

select is(
  (select late_grace_minutes from public.settings),
  10,
  'supervisor cannot change settings'
);

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000003c1');
set local role authenticated;

select lives_ok(
  $$ update public.settings set low_accuracy_threshold_m = 50 $$,
  'admin can change settings'
);

select throws_ok(
  $$ insert into public.attendance_events (shift_id, officer_id, type, latitude, longitude, device_id)
     values ('00000000-0000-0000-0000-000000005c00', '00000000-0000-0000-0000-0000000003a3', 'clock_in', 6.5, 3.4, 'x') $$,
  '42501',
  null,
  'not even an admin can insert attendance directly'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Missed-shift job (runs as postgres, like pg_cron)
-- ---------------------------------------------------------------------------

select public.mark_missed_shifts();

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-000000005a00'),
  'missed',
  'a shift with no clock-in after start + grace is marked missed'
);

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-000000005c00'),
  'scheduled',
  'a shift still inside the grace period is not marked missed'
);

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-000000005a02'),
  'in_progress',
  'a shift with a clock-in is not marked missed'
);

select * from finish();
rollback;
