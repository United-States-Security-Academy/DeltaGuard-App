-- Phase 20 tests: device integrity verdicts, signals flagged to supervisors,
-- and enforcement on clock-in/out and quiz submission. Run with: pnpm db:test
--
-- Officer O works at site S (supervisor S1 too); supervisor S2 has another site.
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

select plan(31);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000020a1', 'p20.o@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P20 Officer"}'),
  ('00000000-0000-0000-0000-0000000020e1', 'p20.s1@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P20 Sup One"}'),
  ('00000000-0000-0000-0000-0000000020e2', 'p20.s2@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P20 Sup Two"}'),
  ('00000000-0000-0000-0000-0000000020f1', 'p20.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P20 Admin"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'android');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000020c001', 'P20 Client');
insert into public.sites (id, client_id, name, latitude, longitude, clock_in_radius_m) values
  ('00000000-0000-0000-0000-00000020501e', '00000000-0000-0000-0000-00000020c001', 'P20 Site', 6.5, 3.4, 150),
  ('00000000-0000-0000-0000-00000020502e', '00000000-0000-0000-0000-00000020c001', 'P20 Other', 6.6, 3.5, 150);
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000020501e', '00000000-0000-0000-0000-0000000020a1'),
  ('00000000-0000-0000-0000-00000020501e', '00000000-0000-0000-0000-0000000020e1'),
  ('00000000-0000-0000-0000-00000020502e', '00000000-0000-0000-0000-0000000020e2');
insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000205a1', '00000000-0000-0000-0000-00000020501e', '00000000-0000-0000-0000-0000000020a1', now() - interval '5 minutes', now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000205a2', '00000000-0000-0000-0000-00000020501e', '00000000-0000-0000-0000-0000000020a1', now() + interval '2 hours', now() + interval '3 hours');

-- A 1-attempt quiz for O, already read.
insert into public.lessons (id, title, pdf_path, page_count, page_image_paths) values
  ('00000000-0000-0000-0000-00000020d001', 'P20 Lesson', '00000000-0000-0000-0000-00000020d001/u/original.pdf', 1,
   array['00000000-0000-0000-0000-00000020d001/u/page-1.png']);
insert into public.assessments (id, lesson_id, max_attempts) values
  ('00000000-0000-0000-0000-00000020e101', '00000000-0000-0000-0000-00000020d001', 3);
insert into public.questions (id, assessment_id, type, prompt, sort_order) values
  ('00000000-0000-0000-0000-00000020f101', '00000000-0000-0000-0000-00000020e101', 'single_choice', 'Q?', 1);
insert into public.question_options (id, question_id, text, is_correct, sort_order) values
  ('00000000-0000-0000-0000-000000201101', '00000000-0000-0000-0000-00000020f101', 'Yes', true, 1),
  ('00000000-0000-0000-0000-000000201102', '00000000-0000-0000-0000-00000020f101', 'No', false, 2);
update public.lessons set status = 'published' where id = '00000000-0000-0000-0000-00000020d001';
insert into public.lesson_assignments (lesson_id, officer_id) values
  ('00000000-0000-0000-0000-00000020d001', '00000000-0000-0000-0000-0000000020a1');
insert into public.lesson_progress (lesson_id, officer_id, pages_viewed, completed_reading_at)
values ('00000000-0000-0000-0000-00000020d001', '00000000-0000-0000-0000-0000000020a1', array[1], now());

update public.settings set integrity_enforcement = 'monitor' where id;

create function pg_temp.login_as(uid uuid) returns void language sql security definer as $$
  select set_config(
    'request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
      'user_id', uid,
      'claims', jsonb_build_object('sub', uid, 'role', 'authenticated')
    )) -> 'claims')::text,
    true
  );
$$;

create function pg_temp.flags(p_type text, p_shift uuid) returns text[] language sql as $$
  select flags from public.attendance_events
   where shift_id = p_shift and type::text = p_type and accepted order by recorded_at desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Only the server records integrity
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.device_integrity_challenges'::regclass),
  'challenges have RLS'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select throws_ok(
  $$ select count(*) from public.device_integrity_challenges $$,
  '42501', null,
  'challenges are not readable through the API'
);
select throws_ok(
  $$ update public.user_devices set integrity_status = 'verified', integrity_checked_at = now()
      where user_id = '00000000-0000-0000-0000-0000000020a1' $$,
  '42501', null,
  'an officer can''t mark their own phone verified'
);
select throws_ok(
  $$ update public.user_devices set integrity_reasons = array['all good']
      where user_id = '00000000-0000-0000-0000-0000000020a1' $$,
  '42501', null,
  'or edit the recorded reasons'
);
select throws_ok(
  $$ select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'verified', '{}', '{}') $$,
  '42501', null,
  'officers can''t record verdicts'
);
select ok(
  not has_function_privilege('authenticated', 'public.save_attest_key(uuid, text, text, jsonb, bigint)', 'execute'),
  'nor App Attest keys'
);
set local role postgres;

select is(
  (select integrity_status from public.user_devices where device_id = 'p20-phone'),
  'unknown',
  'a registered phone starts unchecked'
);

-- ---------------------------------------------------------------------------
-- Clock-in/out flags (monitor mode)
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000205a1', 'clock_in', 6.5, 3.4, 5, false, 'p20-phone')).accepted,
  'an unchecked phone can clock in'
);
set local role postgres;
select ok(
  not (pg_temp.flags('clock_in', '00000000-0000-0000-0000-0000000205a1') && array['device_unverified', 'device_failed']),
  'and "not checked yet" doesn''t flag the clock-in (it would make every clock-in an exception)'
);

select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'verified', '{}', '{}');
select is(public.device_integrity_for('00000000-0000-0000-0000-0000000020a1'), 'verified', 'a passed check counts as verified');

select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000205a1', 'clock_out', 6.5, 3.4, 5, false, 'p20-phone')).accepted,
  'a verified phone clocks out'
);
set local role postgres;
select ok(
  not (pg_temp.flags('clock_out', '00000000-0000-0000-0000-0000000205a1') && array['device_unverified', 'device_failed']),
  'with no device flag'
);

update public.user_devices set integrity_checked_at = now() - interval '25 hours' where device_id = 'p20-phone';
select is(public.device_integrity_for('00000000-0000-0000-0000-0000000020a1'), 'unverified', 'a verdict older than 24 hours no longer counts');

-- ---------------------------------------------------------------------------
-- Signals and failures are flagged to supervisors
-- ---------------------------------------------------------------------------

select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'verified', '{}', array['rooted', 'bogus']);
select is(public.device_integrity_for('00000000-0000-0000-0000-0000000020a1'), 'failed', 'a rooted phone counts as failed even with a passed check');
select is(
  (select integrity_signals from public.user_devices where device_id = 'p20-phone'),
  array['rooted'],
  'only known signals are kept'
);
select results_eq(
  $$ select user_id from public.notifications where type = 'device_integrity'
      and user_id::text like '00000000-0000-0000-0000-000000002%' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-0000000020e1'::uuid), ('00000000-0000-0000-0000-0000000020f1'::uuid) $$,
  'the officer''s supervisor and the admins are told (not other supervisors)'
);
select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'verified', '{}', array['rooted']);
select is(
  (select count(*)::int from public.notifications where type = 'device_integrity'
    and user_id::text like '00000000-0000-0000-0000-000000002%'),
  2,
  'the same signal again the same day sends nothing new'
);
select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'verified', '{}', array['rooted', 'mock_location']);
select is(
  (select count(*)::int from public.notifications where type = 'device_integrity'
    and user_id::text like '00000000-0000-0000-0000-000000002%'),
  4,
  'a new signal (fake location) is flagged again'
);
select throws_ok(
  $$ select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'someone-elses-phone', 'verified', '{}', '{}') $$,
  '42501', null,
  'verdicts only land on the officer''s registered phone'
);

-- ---------------------------------------------------------------------------
-- Quiz submission and block mode
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select lives_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000020e101') $$,
  'a quiz starts'
);
select lives_ok(
  $$ select public.submit_attempt('00000000-0000-0000-0000-00000020e101',
       '{"00000000-0000-0000-0000-00000020f101": ["00000000-0000-0000-0000-000000201101"]}') $$,
  'in monitor mode a flagged phone can still submit'
);
set local role postgres;
select is(
  (select device_integrity from public.assessment_attempts
    where assessment_id = '00000000-0000-0000-0000-00000020e101' and submitted_at is not null),
  'failed',
  'and the attempt records the phone''s state'
);

update public.settings set integrity_enforcement = 'block' where id;
delete from public.assessment_attempts where assessment_id = '00000000-0000-0000-0000-00000020e101';

select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select lives_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000020e101') $$,
  'block mode: starting is fine'
);
select throws_ok(
  $$ select public.submit_attempt('00000000-0000-0000-0000-00000020e101',
       '{"00000000-0000-0000-0000-00000020f101": ["00000000-0000-0000-0000-000000201101"]}') $$,
  'DG020', null,
  'block mode: a failed phone can''t submit a quiz'
);
set local role postgres;
update public.shifts set starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours'
 where id = '00000000-0000-0000-0000-0000000205a1';
update public.shifts set starts_at = now() - interval '5 minutes', ends_at = now() + interval '1 hour'
 where id = '00000000-0000-0000-0000-0000000205a2';

select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-0000000205a2', 'clock_in', 6.5, 3.4, 5, false, 'p20-phone') $$,
  'DG020', null,
  'block mode: a failed phone can''t clock in'
);
set local role postgres;

select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'unavailable', array['not_configured'], '{}');
select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000205a2', 'clock_in', 6.5, 3.4, 5, false, 'p20-phone')).accepted,
  'block mode never blocks a phone whose check couldn''t run (no lock-out on misconfiguration)'
);
set local role postgres;
select ok(
  not (pg_temp.flags('clock_in', '00000000-0000-0000-0000-0000000205a2') && array['device_unverified', 'device_failed']),
  'and isn''t flagged as an exception'
);

-- Monitor mode, failed phone: the clock event goes through, flagged device_failed.
update public.settings set integrity_enforcement = 'monitor' where id;
select public.record_device_integrity('00000000-0000-0000-0000-0000000020a1', 'p20-phone', 'failed', array['device_integrity'], '{}');
select pg_temp.login_as('00000000-0000-0000-0000-0000000020a1');
set local role authenticated;
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000205a2', 'clock_out', 6.5, 3.4, 5, false, 'p20-phone')).accepted,
  'monitor mode: a failed phone can still clock out'
);
set local role postgres;
select ok(
  'device_failed' = any (pg_temp.flags('clock_out', '00000000-0000-0000-0000-0000000205a2')),
  'and the clock-out is flagged device_failed for supervisors'
);

select ok(
  exists (select 1 from pg_trigger where tgname = 'form_submissions_integrity')
  and pg_get_functiondef('public.form_submissions_integrity'::regproc) ~ 'device_integrity_gate',
  'form submission goes through the same gate'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000020e1');
set local role authenticated;
select is_empty(
  $$ update public.settings set integrity_enforcement = 'monitor' where id returning 1 $$,
  'supervisors can''t change the enforcement mode'
);
set local role postgres;

select * from finish();
rollback;
