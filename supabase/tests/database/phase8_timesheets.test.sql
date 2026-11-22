-- Phase 8 tests: timesheet entries from attendance, corrections (audited),
-- approval, pay period locking, midnight-crossing shifts and the company
-- time zone (Africa/Lagos, UTC+1). Run with: pnpm db:test
--
-- Attendance is inserted directly (as postgres) at fixed past dates so the
-- results don't depend on today's date.
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

select plan(40);

update public.settings set time_zone = 'Africa/Lagos';

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008a1', 'p8.officer.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P8 Officer A"}'),
  ('00000000-0000-0000-0000-0000000008b1', 'p8.officer.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P8 Officer B"}'),
  ('00000000-0000-0000-0000-0000000008e1', 'p8.supervisor@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P8 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000008f1', 'p8.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P8 Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000008c001', 'P8 Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-00000008c001', 'P8 Site S');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008a1'),
  ('00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008b1'),
  ('00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008e1');

-- Lagos is UTC+1: 22:00 Lagos = 21:00Z.
insert into public.shifts (id, site_id, officer_id, starts_at, ends_at, status) values
  -- A1: night shift 5 Jan 22:00 -> 6 Jan 06:00 (Lagos)
  ('00000000-0000-0000-0000-00000008a001', '00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008a1', '2026-01-05 21:00:00+00', '2026-01-06 05:00:00+00', 'completed'),
  -- A2: 6 Jan 08:00-16:00, clocked in, forgot to clock out
  ('00000000-0000-0000-0000-00000008a002', '00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008a1', '2026-01-06 07:00:00+00', '2026-01-06 15:00:00+00', 'in_progress'),
  -- A3: 7 Jan, missed (set below)
  ('00000000-0000-0000-0000-00000008a003', '00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008a1', '2026-01-07 07:00:00+00', '2026-01-07 15:00:00+00', 'scheduled'),
  -- A5: 8 Jan, only a refused attempt from another phone
  ('00000000-0000-0000-0000-00000008a005', '00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008a1', '2026-01-08 07:00:00+00', '2026-01-08 15:00:00+00', 'missed'),
  -- B1: 5 Jan 08:00-16:00, clock-in sent late from the offline queue
  ('00000000-0000-0000-0000-00000008b001', '00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008b1', '2026-01-05 07:00:00+00', '2026-01-05 15:00:00+00', 'completed'),
  -- B2: starts 7 Jan 00:30 Lagos = 6 Jan 23:30Z
  ('00000000-0000-0000-0000-00000008b002', '00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008b1', '2026-01-06 23:30:00+00', '2026-01-07 07:30:00+00', 'completed'),
  -- S1: the supervisor's own shift
  ('00000000-0000-0000-0000-00000008e001', '00000000-0000-0000-0000-00000008501e', '00000000-0000-0000-0000-0000000008e1', '2026-01-06 07:00:00+00', '2026-01-06 15:00:00+00', 'completed');

insert into public.attendance_events (shift_id, officer_id, type, recorded_at, device_time, latitude, longitude, device_id, flags, accepted) values
  ('00000000-0000-0000-0000-00000008a001', '00000000-0000-0000-0000-0000000008a1', 'clock_in',  '2026-01-05 21:05:00+00', null, 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-00000008a001', '00000000-0000-0000-0000-0000000008a1', 'clock_out', '2026-01-06 05:02:00+00', null, 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-00000008a002', '00000000-0000-0000-0000-0000000008a1', 'clock_in',  '2026-01-06 07:20:00+00', null, 6.5, 3.4, 'p', '{late}', true),
  ('00000000-0000-0000-0000-00000008a005', '00000000-0000-0000-0000-0000000008a1', 'clock_in',  '2026-01-08 07:00:00+00', null, 6.5, 3.4, 'x', '{wrong_device}', false),
  ('00000000-0000-0000-0000-00000008b001', '00000000-0000-0000-0000-0000000008b1', 'clock_in',  '2026-01-05 12:00:00+00', '2026-01-05 07:01:00+00', 6.5, 3.4, 'p', '{delayed}', true),
  ('00000000-0000-0000-0000-00000008b001', '00000000-0000-0000-0000-0000000008b1', 'clock_out', '2026-01-05 15:00:00+00', null, 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-00000008b002', '00000000-0000-0000-0000-0000000008b1', 'clock_in',  '2026-01-06 23:31:00+00', null, 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-00000008b002', '00000000-0000-0000-0000-0000000008b1', 'clock_out', '2026-01-07 07:30:00+00', null, 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-00000008e001', '00000000-0000-0000-0000-0000000008e1', 'clock_in',  '2026-01-06 07:00:00+00', null, 6.5, 3.4, 'p', '{}', true),
  ('00000000-0000-0000-0000-00000008e001', '00000000-0000-0000-0000-0000000008e1', 'clock_out', '2026-01-06 15:00:00+00', null, 6.5, 3.4, 'p', '{}', true);

update public.shifts set status = 'missed' where id = '00000000-0000-0000-0000-00000008a003';

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

create function pg_temp.entry(p_shift uuid) returns uuid language sql as $$
  select id from public.timesheet_entries where shift_id = p_shift
$$;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_class
    where relnamespace = 'public'::regnamespace and relrowsecurity
      and relname in ('pay_periods', 'timesheet_entries', 'timesheet_corrections')),
  3,
  'RLS is enabled on every Phase 8 table'
);

select ok(
  not has_table_privilege('authenticated', 'public.timesheet_entries', 'update')
  and not has_table_privilege('authenticated', 'public.timesheet_entries', 'insert')
  and not has_table_privilege('authenticated', 'public.timesheet_corrections', 'insert'),
  'signed-in users cannot write timesheet entries or corrections directly'
);

-- ---------------------------------------------------------------------------
-- Entries derived from attendance
-- ---------------------------------------------------------------------------

select is(
  (select work_date from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a001'),
  '2026-01-05'::date,
  'a night shift belongs to the day it starts'
);

select is(
  (select worked_minutes from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a001'),
  477,
  '...and counts every minute across midnight (21:05Z -> 05:02Z = 7 h 57)'
);

select is(
  (select work_date from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008b002'),
  '2026-01-07'::date,
  'the work date is in the company time zone (00:30 Lagos on 7 Jan is 23:30Z on 6 Jan)'
);

select is(
  (select original_clock_in_at from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008b001'),
  '2026-01-05 07:01:00+00'::timestamptz,
  'a delayed clock-in counts from the phone''s time, not when it reached the server'
);

select is(
  (select flags from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008b001'),
  array['delayed']::text[],
  'attendance flags are copied to the entry'
);

select is(
  (select worked_minutes from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a002'),
  null,
  'no clock-out: no worked minutes'
);

select is(
  (select original_clock_in_at is null and original_clock_out_at is null
     from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a003'),
  true,
  'a missed shift gets an entry with no times'
);

select is(
  (select count(*)::int from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a005'),
  0,
  'a refused attempt from another phone creates no entry'
);

-- ---------------------------------------------------------------------------
-- Who can read
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000008a1');
set local role authenticated;

select is(
  (select count(*)::int from public.timesheet_entries),
  3,
  'an officer reads only their own entries'
);

select throws_ok(
  $$ select public.correct_timesheet_entry(pg_temp.entry('00000000-0000-0000-0000-00000008a002'),
       '2026-01-06 07:20:00+00', '2026-01-06 15:00:00+00', 'I forgot') $$,
  '42501', 'Not allowed',
  'an officer cannot correct a timesheet'
);

select throws_ok(
  $$ select public.approve_timesheet_entries(array[pg_temp.entry('00000000-0000-0000-0000-00000008a001')]) $$,
  '42501', 'Not allowed',
  'an officer cannot approve'
);

-- ---------------------------------------------------------------------------
-- Corrections (supervisor)
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000008e1');
set local role authenticated;

select is(
  (select count(*)::int from public.timesheet_entries
    where officer_id in ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008b1')),
  5,
  'a supervisor reads every entry'
);

select throws_ok(
  $$ select public.correct_timesheet_entry(pg_temp.entry('00000000-0000-0000-0000-00000008a002'),
       '2026-01-06 07:20:00+00', '2026-01-06 15:00:00+00', '  ') $$,
  '22023', 'Give a reason for the correction',
  'a correction needs a reason'
);

select throws_ok(
  $$ select public.correct_timesheet_entry(pg_temp.entry('00000000-0000-0000-0000-00000008a002'),
       '2026-01-06 15:00:00+00', '2026-01-06 07:20:00+00', 'Swapped') $$,
  '22023', 'The clock-out must be after the clock-in',
  'the clock-out must be after the clock-in'
);

select lives_ok(
  $$ select public.correct_timesheet_entry(pg_temp.entry('00000000-0000-0000-0000-00000008a002'),
       '2026-01-06 07:20:00+00', '2026-01-06 15:00:00+00',
       'Phone battery died; site manager confirmed he left at 16:00') $$,
  'a supervisor corrects a missing clock-out'
);

select is(
  (select worked_minutes from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a002'),
  460,
  'worked minutes use the corrected times'
);

select is(
  (select original_clock_out_at from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a002'),
  null,
  'the original time is kept as it was'
);

set local role postgres;
select is(
  (select count(*)::int from public.attendance_events where shift_id = '00000000-0000-0000-0000-00000008a002'),
  1,
  'attendance events are never changed by a correction'
);
set local role authenticated;

select is(
  (select reason || ' | ' || coalesce(previous_clock_out_at::text, 'none') || ' -> '
          || new_clock_out_at::text || ' | ' || corrected_by::text
     from public.timesheet_corrections
    where entry_id = pg_temp.entry('00000000-0000-0000-0000-00000008a002')),
  'Phone battery died; site manager confirmed he left at 16:00 | none -> 2026-01-06 15:00:00+00 | 00000000-0000-0000-0000-0000000008e1',
  'the correction is audited: reason, previous and new value, who'
);

select throws_ok(
  $$ select public.correct_timesheet_entry(pg_temp.entry('00000000-0000-0000-0000-00000008e001'),
       '2026-01-06 07:00:00+00', '2026-01-06 16:00:00+00', 'Overtime') $$,
  '42501', 'You can''t correct your own timesheet',
  'a supervisor cannot correct their own timesheet'
);

-- ---------------------------------------------------------------------------
-- Approval
-- ---------------------------------------------------------------------------

select is(
  public.approve_timesheet_entries(array[
    pg_temp.entry('00000000-0000-0000-0000-00000008a001'),
    pg_temp.entry('00000000-0000-0000-0000-00000008a002'),
    pg_temp.entry('00000000-0000-0000-0000-00000008a003'),
    pg_temp.entry('00000000-0000-0000-0000-00000008b001'),
    pg_temp.entry('00000000-0000-0000-0000-00000008e001')
  ]),
  4,
  'bulk approval approves everything allowed (not the supervisor''s own entry)'
);

select is(
  (select status::text from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008e001'),
  'pending',
  '...so their own entry stays pending'
);

select lives_ok(
  $$ select public.correct_timesheet_entry(pg_temp.entry('00000000-0000-0000-0000-00000008b001'),
       '2026-01-05 07:00:00+00', '2026-01-05 15:00:00+00', 'Rounded to the schedule') $$,
  'an approved entry can still be corrected while the period is open'
);

select is(
  (select status::text from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008b001'),
  'pending',
  '...which sends it back for approval'
);

select is(
  public.approve_timesheet_entries(array[pg_temp.entry('00000000-0000-0000-0000-00000008b001')]),
  1,
  'it can be approved again'
);

-- ---------------------------------------------------------------------------
-- Pay periods
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.pay_periods (starts_on, ends_on) values ('2026-01-01', '2026-01-15') $$,
  '42501', null,
  'a supervisor cannot create pay periods'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000008f1');
set local role authenticated;

select lives_ok(
  $$ insert into public.pay_periods (id, starts_on, ends_on)
     values ('00000000-0000-0000-0000-00000008d001', '2026-01-01', '2026-01-15') $$,
  'an admin creates a pay period'
);

select throws_ok(
  $$ insert into public.pay_periods (starts_on, ends_on) values ('2026-01-10', '2026-01-20') $$,
  '23P01', null,
  'pay periods cannot overlap'
);

select throws_ok(
  $$ select public.lock_pay_period('00000000-0000-0000-0000-00000008d001') $$,
  'P0001', '2 timesheet entries still need approval',
  'a period cannot be locked with unapproved entries'
);

select is(
  public.approve_timesheet_entries(array[
    pg_temp.entry('00000000-0000-0000-0000-00000008e001'),
    pg_temp.entry('00000000-0000-0000-0000-00000008b002')
  ]),
  2,
  'an admin approves the rest (including the supervisor''s own entry)'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000008e1');
set local role authenticated;

select throws_ok(
  $$ select public.lock_pay_period('00000000-0000-0000-0000-00000008d001') $$,
  '42501', 'Not allowed',
  'a supervisor cannot lock a pay period'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000008f1');
set local role authenticated;

select is(
  (public.lock_pay_period('00000000-0000-0000-0000-00000008d001')).status::text,
  'locked',
  'an admin locks the period'
);

select throws_ok(
  $$ select public.correct_timesheet_entry(pg_temp.entry('00000000-0000-0000-0000-00000008a001'),
       '2026-01-05 21:00:00+00', '2026-01-06 05:00:00+00', 'Late change') $$,
  'P0001', 'This pay period is locked',
  'nothing in a locked period can be corrected'
);

select throws_ok(
  $$ delete from public.pay_periods where id = '00000000-0000-0000-0000-00000008d001' $$,
  'P0001', 'This pay period is locked',
  'a locked period cannot be deleted'
);

set local role postgres;

select lives_ok(
  $$ insert into public.attendance_events (shift_id, officer_id, type, recorded_at, latitude, longitude, device_id, flags, accepted)
     values ('00000000-0000-0000-0000-00000008a003', '00000000-0000-0000-0000-0000000008a1', 'clock_in',
             now(), 6.5, 3.4, 'p', '{delayed}', true) $$,
  'attendance for a locked period is still recorded'
);

select is(
  (select original_clock_in_at from public.timesheet_entries where shift_id = '00000000-0000-0000-0000-00000008a003'),
  null,
  '...but doesn''t change the locked timesheet'
);

select throws_ok(
  $$ update public.timesheet_entries set corrected_clock_in_at = now()
      where shift_id = '00000000-0000-0000-0000-00000008a001' $$,
  'P0001', 'This pay period is locked',
  'not even the database owner can change an entry in a locked period'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000008f1');
set local role authenticated;

insert into public.pay_periods (id, starts_on, ends_on)
values ('00000000-0000-0000-0000-00000008d002', current_date - 1, current_date + 5);

select throws_ok(
  $$ select public.lock_pay_period('00000000-0000-0000-0000-00000008d002') $$,
  'P0001', 'This pay period hasn''t ended yet',
  'a period cannot be locked before it ends'
);

select * from finish();
rollback;
