-- Phase 5 tests: acknowledge_shift(), shifts.acknowledged_at, and clock
-- events queued offline (clock_event p_queued). Run with: pnpm db:test
--
-- now() is fixed for the whole transaction, so times are relative to it.
begin;

set local role postgres;

create extension if not exists pgtap with schema extensions;

select set_config(
  'search_path',
  current_setting('search_path') || ', '
    || (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap'),
  true
);

select plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- Site S at 6.5, 3.4, radius 150 m. Officers E and F and suspended officer G
-- are assigned to it.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000005e1', 'p5.officer.e@test.local', '{"role":"officer","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000005f1', 'p5.officer.f@test.local', '{"role":"officer","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000005a1', 'p5.suspended@test.local', '{"role":"officer","employment_status":"suspended"}'),
  ('00000000-0000-0000-0000-0000000005b1', 'p5.supervisor@test.local', '{"role":"supervisor","employment_status":"active"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000005e1', 'phone-e', 'android'),
  ('00000000-0000-0000-0000-0000000005a1', 'phone-g', 'android');
-- Phase 20: mark fixture phones verified, so attendance flags here stay
-- about attendance (device flags have their own tests).
update public.user_devices set integrity_status = 'verified', integrity_checked_at = now();

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000005c001', 'P5 Client');

insert into public.sites (id, client_id, name, latitude, longitude, clock_in_radius_m) values
  ('00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-00000005c001', 'P5 Site S', 6.5, 3.4, 150);

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005e1'),
  ('00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005f1'),
  ('00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005a1');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  -- E1: tomorrow-ish, to acknowledge
  ('00000000-0000-0000-0000-00000005e001', '00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005e1', now() + interval '2 hours', now() + interval '10 hours'),
  -- E2: ended an hour ago; the phone was offline the whole time
  ('00000000-0000-0000-0000-00000005e002', '00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005e1', now() - interval '5 hours', now() - interval '1 hour'),
  -- E3: a day and a half ago, for a late queued clock-in
  ('00000000-0000-0000-0000-00000005e003', '00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005e1', now() - interval '40 hours', now() - interval '30 hours'),
  -- E4: more than 72 hours ago
  ('00000000-0000-0000-0000-00000005e004', '00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005e1', now() - interval '80 hours', now() - interval '76 hours'),
  -- E5: started 5 minutes ago, for a live clock-in
  ('00000000-0000-0000-0000-00000005e005', '00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005e1', now() - interval '5 minutes', now() + interval '90 minutes'),
  -- F1: Officer F's shift
  ('00000000-0000-0000-0000-00000005f001', '00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005f1', now() + interval '2 hours', now() + interval '10 hours'),
  -- G1: suspended officer's shift
  ('00000000-0000-0000-0000-00000005a001', '00000000-0000-0000-0000-00000005501e', '00000000-0000-0000-0000-0000000005a1', now() + interval '2 hours', now() + interval '10 hours');

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

select ok(
  not has_function_privilege('anon', 'public.acknowledge_shift(uuid)', 'execute'),
  'anon cannot call acknowledge_shift'
);

select ok(
  has_function_privilege('authenticated', 'public.acknowledge_shift(uuid)', 'execute'),
  'signed-in users can call acknowledge_shift'
);

select is(
  (select count(*)::int from pg_proc where proname = 'clock_event' and pronamespace = 'public'::regnamespace),
  1,
  'clock_event has a single signature (no leftover overload)'
);

-- ---------------------------------------------------------------------------
-- Acknowledging
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000005e1');
set local role authenticated;

select is(
  (public.acknowledge_shift('00000000-0000-0000-0000-00000005e001')).status::text,
  'acknowledged',
  'an officer can acknowledge their own scheduled shift'
);

select is(
  (select acknowledged_at from public.shifts where id = '00000000-0000-0000-0000-00000005e001'),
  now(),
  'acknowledged_at is stamped with server time'
);

select lives_ok(
  $$ select public.acknowledge_shift('00000000-0000-0000-0000-00000005e001') $$,
  'acknowledging twice is fine'
);

select throws_ok(
  $$ select public.acknowledge_shift('00000000-0000-0000-0000-00000005f001') $$,
  '42501', 'Shift not found',
  'an officer cannot acknowledge someone else''s shift'
);

select throws_ok(
  $$ select public.acknowledge_shift('00000000-0000-0000-0000-00000005e002') $$,
  'P0001', 'This shift has already ended',
  'a shift that has ended cannot be acknowledged'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000005a1');
set local role authenticated;

select throws_ok(
  $$ select public.acknowledge_shift('00000000-0000-0000-0000-00000005a001') $$,
  '42501', 'Not allowed',
  'a suspended officer cannot acknowledge'
);

-- ---------------------------------------------------------------------------
-- acknowledged_at is protected
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000005b1');
set local role authenticated;

update public.shifts set acknowledged_at = '2000-01-01 00:00:00+00', notes = 'p5 note'
 where id = '00000000-0000-0000-0000-00000005f001';

select is(
  (select acknowledged_at from public.shifts where id = '00000000-0000-0000-0000-00000005f001'),
  null,
  'staff cannot set acknowledged_at directly (the value is ignored)'
);

select is(
  (select notes from public.shifts where id = '00000000-0000-0000-0000-00000005f001'),
  'p5 note',
  '...while the rest of the update still applies'
);

update public.shifts set status = 'scheduled' where id = '00000000-0000-0000-0000-00000005e001';

select is(
  (select acknowledged_at from public.shifts where id = '00000000-0000-0000-0000-00000005e001'),
  null,
  'a shift put back to scheduled loses its acknowledgement'
);

-- ---------------------------------------------------------------------------
-- Clock events queued offline
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000005e1');
set local role authenticated;

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-00000005e002', 'clock_in', 6.5, 3.4, 10, false, 'phone-e') $$,
  'P0001', 'This shift has already ended',
  'a live clock-in after the shift ended is refused'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-00000005e002', 'clock_in', 6.5, 3.4, 10, false, 'phone-e', null, true) $$,
  '22023', 'A delayed clock event needs the time it happened',
  'a queued event must carry the phone''s time'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-00000005e001', 'clock_in', 6.5, 3.4, 10, false, 'phone-e', now() + interval '10 minutes', true) $$,
  '22023', 'The time on this phone is wrong. Set it to automatic and try again',
  'a queued event from the future is refused'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-00000005e004', 'clock_in', 6.5, 3.4, 10, false, 'phone-e', now() - interval '79 hours', true) $$,
  'P0001', 'This clock event is more than 72 hours old. Ask your supervisor to correct your timesheet',
  'a queued event older than 72 hours is refused'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000005e002', 'clock_in', 6.5, 3.4, 10, false, 'phone-e', now() - interval '4 hours 55 minutes', true)).flags,
  array['delayed']::text[],
  'a queued on-time clock-in is accepted, flagged delayed, not late'
);

select is(
  (select recorded_at from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-00000005e002' and type = 'clock_in'),
  now(),
  'a queued event''s recorded_at is when the server received it'
);

select is(
  (select device_time from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-00000005e002' and type = 'clock_in'),
  now() - interval '4 hours 55 minutes',
  '...and device_time is when it happened'
);

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-00000005e002'),
  'in_progress',
  'a queued clock-in starts the shift'
);

select throws_ok(
  $$ select public.acknowledge_shift('00000000-0000-0000-0000-00000005e002') $$,
  'P0001', 'This shift is in progress',
  'a shift in progress cannot be acknowledged'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000005e002', 'clock_out', 6.5, 3.4, 10, false, 'phone-e', now() - interval '59 minutes', true)).flags,
  array['delayed']::text[],
  'a queued clock-out after the end is not flagged early'
);

select is(
  (select status::text from public.shifts where id = '00000000-0000-0000-0000-00000005e002'),
  'completed',
  'a queued clock-out completes the shift'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000005e003', 'clock_in', 6.5, 3.4, 10, false, 'not-my-phone', now() - interval '39 hours', true)).flags,
  array['delayed', 'wrong_device']::text[],
  'a queued attempt from another phone is kept as refused, flagged delayed and wrong_device'
);

select is(
  (select accepted from public.attendance_events
    where shift_id = '00000000-0000-0000-0000-00000005e003' and device_id = 'not-my-phone'),
  false,
  '...and is not accepted'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-00000005e003', 'clock_in', 6.509, 3.4, 10, false, 'phone-e', now() - interval '39 hours', true) $$,
  'DG002',
  null,
  'a queued clock-in taken 1 km from the site is refused'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000005e003', 'clock_in', 6.5, 3.4, 10, false, 'phone-e', now() - interval '39 hours', true)).flags,
  array['delayed', 'late']::text[],
  'a queued clock-in is judged late by the phone''s time'
);

-- Old 8-argument calls still work (p_queued defaults to false).
select is(
  (public.clock_event('00000000-0000-0000-0000-00000005e005', 'clock_in', 6.5, 3.4, 10, false, 'phone-e', '2000-01-01 00:00:00+00')).flags,
  array[]::text[],
  'a live call ignores the phone''s clock for the rules, as before'
);

select * from finish();
rollback;
