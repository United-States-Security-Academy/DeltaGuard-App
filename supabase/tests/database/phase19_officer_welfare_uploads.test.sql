-- Phase 19 tests: per-officer welfare settings, the quiz attempt limit, and
-- upload verification gating. Run with: pnpm db:test
--
-- Site S1 runs policy "P19 Site" (checks on); site S2 has checks off.
-- Officer O1 works at S1, O2 at S2. Policy "P19 Officer" is for officers.
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

select plan(44);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000019a1', 'p19.o1@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P19 Officer One"}'),
  ('00000000-0000-0000-0000-0000000019a2', 'p19.o2@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P19 Officer Two"}'),
  ('00000000-0000-0000-0000-0000000019e1', 'p19.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P19 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000019f1', 'p19.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P19 Admin"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000019a1', 'p19-phone-1', 'ios'),
  ('00000000-0000-0000-0000-0000000019a2', 'p19-phone-2', 'android');

insert into public.welfare_check_policies (id, name, min_interval_minutes, max_interval_minutes) values
  ('00000000-0000-0000-0000-00000019f001', 'P19 Site', 20, 40),
  ('00000000-0000-0000-0000-00000019f002', 'P19 Officer', 60, 90);
update public.settings set welfare_policy_id = null where id;

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000019c001', 'P19 Client');
insert into public.sites (id, client_id, name, latitude, longitude, clock_in_radius_m, welfare_policy_id, welfare_checks_enabled) values
  ('00000000-0000-0000-0000-00000019501e', '00000000-0000-0000-0000-00000019c001', 'P19 Site One', 6.5, 3.4, 150,
   '00000000-0000-0000-0000-00000019f001', true),
  ('00000000-0000-0000-0000-00000019502e', '00000000-0000-0000-0000-00000019c001', 'P19 Site Two', 6.6, 3.5, 150,
   '00000000-0000-0000-0000-00000019f001', false);

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000019501e', '00000000-0000-0000-0000-0000000019a1'),
  ('00000000-0000-0000-0000-00000019502e', '00000000-0000-0000-0000-0000000019a2');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000195a1', '00000000-0000-0000-0000-00000019501e', '00000000-0000-0000-0000-0000000019a1', now() - interval '5 minutes', now() + interval '6 hours'),
  ('00000000-0000-0000-0000-0000000195a2', '00000000-0000-0000-0000-00000019502e', '00000000-0000-0000-0000-0000000019a2', now() - interval '5 minutes', now() + interval '6 hours');

-- A lesson with a 2-attempt quiz, assigned to O1, already read.
insert into public.lessons (id, title, pdf_path, page_count, page_image_paths) values
  ('00000000-0000-0000-0000-00000019d001', 'P19 Lesson', '00000000-0000-0000-0000-00000019d001/u1/original.pdf', 1,
   array['00000000-0000-0000-0000-00000019d001/u1/page-1.png']);
insert into public.assessments (id, lesson_id, max_attempts) values
  ('00000000-0000-0000-0000-00000019e101', '00000000-0000-0000-0000-00000019d001', 2);
insert into public.questions (id, assessment_id, type, prompt, sort_order) values
  ('00000000-0000-0000-0000-00000019f101', '00000000-0000-0000-0000-00000019e101', 'single_choice', 'Who first?', 1);
insert into public.question_options (id, question_id, text, is_correct, sort_order) values
  ('00000000-0000-0000-0000-000000191101', '00000000-0000-0000-0000-00000019f101', 'Supervisor', true, 1),
  ('00000000-0000-0000-0000-000000191102', '00000000-0000-0000-0000-00000019f101', 'Client', false, 2);
update public.lessons set status = 'published' where id = '00000000-0000-0000-0000-00000019d001';
insert into public.lesson_assignments (lesson_id, officer_id) values
  ('00000000-0000-0000-0000-00000019d001', '00000000-0000-0000-0000-0000000019a1');
insert into public.lesson_progress (lesson_id, officer_id, pages_viewed, completed_reading_at)
values ('00000000-0000-0000-0000-00000019d001', '00000000-0000-0000-0000-0000000019a1', array[1], now());

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

create function pg_temp.open_policy(p_shift uuid) returns text language sql as $$
  select policy ->> 'name' from public.welfare_checks
   where shift_id = p_shift and status in ('scheduled', 'prompted', 'alarm', 'calling')
$$;

-- ---------------------------------------------------------------------------
-- Per-officer welfare settings
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.officer_welfare_settings'::regclass),
  'officer_welfare_settings has RLS'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019e1');
set local role authenticated;
select throws_ok(
  $$ insert into public.officer_welfare_settings (officer_id, mode, policy_id)
     values ('00000000-0000-0000-0000-0000000019a2', 'policy', '00000000-0000-0000-0000-00000019f002') $$,
  '42501', null,
  'supervisors can''t assign welfare policies to officers'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019a2');
select throws_ok(
  $$ insert into public.officer_welfare_settings (officer_id, mode)
     values ('00000000-0000-0000-0000-0000000019a2', 'off') $$,
  '42501', null,
  'officers can''t switch their own checks off'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019f1');
select lives_ok(
  $$ insert into public.officer_welfare_settings (officer_id, mode, policy_id)
     values ('00000000-0000-0000-0000-0000000019a2', 'policy', '00000000-0000-0000-0000-00000019f002') $$,
  'an admin assigns a policy to an officer'
);
select throws_ok(
  $$ insert into public.officer_welfare_settings (officer_id, mode)
     values ('00000000-0000-0000-0000-0000000019a1', 'policy') $$,
  '23514', null,
  'a policy setting needs a policy'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019a2');
select is((select count(*)::int from public.officer_welfare_settings), 0, 'officers can''t read welfare settings');

select pg_temp.login_as('00000000-0000-0000-0000-0000000019a1');
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000195a1', 'clock_in', 6.5, 3.4, 5, false, 'p19-phone-1')).accepted,
  'officer One clocks in'
);
select pg_temp.login_as('00000000-0000-0000-0000-0000000019a2');
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000195a2', 'clock_in', 6.6, 3.5, 5, false, 'p19-phone-2')).accepted,
  'officer Two clocks in'
);
set local role postgres;

select is(pg_temp.open_policy('00000000-0000-0000-0000-0000000195a1'), 'P19 Site',
  'with no setting of their own, an officer follows the site''s policy');
select is(pg_temp.open_policy('00000000-0000-0000-0000-0000000195a2'), 'P19 Officer',
  'an officer''s own policy runs even where the site has checks off');
select ok(
  (select scheduled_at between now() + interval '60 minutes' and now() + interval '90 minutes'
     from public.welfare_checks where shift_id = '00000000-0000-0000-0000-0000000195a2'
      and status = 'scheduled'),
  'and its timing comes from that policy (60-90 minutes)'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019f1');
set local role authenticated;
select lives_ok(
  $$ insert into public.officer_welfare_settings (officer_id, mode)
     values ('00000000-0000-0000-0000-0000000019a1', 'off') $$,
  'an admin switches checks off for officer One while on duty'
);
set local role postgres;
select is(pg_temp.open_policy('00000000-0000-0000-0000-0000000195a1'), null,
  'officer One''s next check is cancelled at once');
select is(
  (select escalation_log -> -1 ->> 'reason' from public.welfare_checks
    where shift_id = '00000000-0000-0000-0000-0000000195a1' and status = 'cancelled'),
  'setting_changed',
  'and the check''s log says why'
);

set local role authenticated;
update public.officer_welfare_settings set mode = 'policy', policy_id = '00000000-0000-0000-0000-00000019f002'
 where officer_id = '00000000-0000-0000-0000-0000000019a1';
set local role postgres;
select is(pg_temp.open_policy('00000000-0000-0000-0000-0000000195a1'), 'P19 Officer',
  'assigning a policy while on duty schedules a check under it straight away');

set local role authenticated;
delete from public.officer_welfare_settings where officer_id = '00000000-0000-0000-0000-0000000019a1';
set local role postgres;
select is(pg_temp.open_policy('00000000-0000-0000-0000-0000000195a1'), 'P19 Site',
  'removing the setting goes back to the site''s policy');

select is(
  (select count(*)::int from public.audit_log
    where action = 'welfare_setting_changed' and target_id = '00000000-0000-0000-0000-0000000019a1'
      and actor_id = '00000000-0000-0000-0000-0000000019f1'),
  3,
  'every change to an officer''s welfare setting is audited'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019f1');
set local role authenticated;
select results_eq(
  $$ select officer_name, policy_name, policy_source from public.welfare_board()
      where officer_name like 'P19%' order by officer_name $$,
  $$ values ('P19 Officer One', 'P19 Site', 'site'), ('P19 Officer Two', 'P19 Officer', 'officer') $$,
  'the board shows each officer''s policy and where it comes from'
);
set local role postgres;

select ok(
  not has_function_privilege('authenticated', 'public.welfare_policy_for(uuid, uuid)', 'execute'),
  'welfare_policy_for is internal'
);

-- ---------------------------------------------------------------------------
-- Quiz attempt limit
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000019a1');
set local role authenticated;

select lives_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000019e101') $$,
  'attempt 1 starts'
);
select is(
  (public.submit_attempt('00000000-0000-0000-0000-00000019e101',
     '{"00000000-0000-0000-0000-00000019f101": ["00000000-0000-0000-0000-000000191102"]}') ->> 'passed')::boolean,
  false,
  'attempt 1: wrong answer, not passed'
);
select lives_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000019e101') $$,
  'attempt 2 starts'
);
select is(
  (public.submit_attempt('00000000-0000-0000-0000-00000019e101',
     '{"00000000-0000-0000-0000-00000019f101": ["00000000-0000-0000-0000-000000191102"]}') ->> 'passed')::boolean,
  false,
  'attempt 2: wrong answer, not passed'
);
select throws_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000019e101') $$,
  'DG011', null,
  'with the admin''s limit used up, the quiz can''t be opened again'
);
select throws_ok(
  $$ select public.submit_attempt('00000000-0000-0000-0000-00000019e101',
       '{"00000000-0000-0000-0000-00000019f101": ["00000000-0000-0000-0000-000000191101"]}') $$,
  'DG011', null,
  'nor submitted again (not even with the right answer)'
);
select is(
  (public.assessment_overview('00000000-0000-0000-0000-00000019e101') ->> 'attempts_left')::int,
  0,
  'the phone is told no attempts are left'
);
select is(
  public.effective_max_attempts(
    (select a from public.assessments a where false),
    '00000000-0000-0000-0000-0000000019a2'),
  0,
  'asking about another officer''s allowance answers 0, never "unlimited"'
);
select throws_ok(
  $$ select public.grant_extra_attempt('00000000-0000-0000-0000-00000019e101', '00000000-0000-0000-0000-0000000019a1', 'Retry') $$,
  '42501', null,
  'officers can''t give themselves another attempt'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019f1');
select lives_ok(
  $$ select public.grant_extra_attempt('00000000-0000-0000-0000-00000019e101', '00000000-0000-0000-0000-0000000019a1', 'Retry approved') $$,
  'an admin grants one more attempt'
);
select pg_temp.login_as('00000000-0000-0000-0000-0000000019a1');
select lives_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000019e101') $$,
  'and only then can the officer take the quiz again'
);

-- ---------------------------------------------------------------------------
-- Upload verification
-- ---------------------------------------------------------------------------

insert into storage.objects (bucket_id, name, owner_id) values
  ('incident-photos', '00000000-0000-0000-0000-0000000019a1/i1/a.jpg', '00000000-0000-0000-0000-0000000019a1'),
  ('incident-photos', '00000000-0000-0000-0000-0000000019a1/i1/b.jpg', '00000000-0000-0000-0000-0000000019a1');

select throws_ok(
  $$ select count(*) from public.upload_checks $$,
  '42501', null,
  'upload checks can''t be read through the API'
);
select is(
  (select count(*)::int from storage.objects where name like '00000000-0000-0000-0000-0000000019a1/i1/%'),
  2,
  'the uploader can read their own files while they are checked'
);

set local role postgres;
select is(
  (select string_agg(status, ',' order by name) from public.upload_checks
    where name like '00000000-0000-0000-0000-0000000019a1/i1/%'),
  'pending,pending',
  'every upload waits for a content check'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019f1');
set local role authenticated;
select is(
  (select count(*)::int from storage.objects where name like '00000000-0000-0000-0000-0000000019a1/i1/%'),
  0,
  'nobody else can read a file before it is checked'
);

set local role postgres;
select public.finish_upload_check('incident-photos', '00000000-0000-0000-0000-0000000019a1/i1/a.jpg', 'clean');
select public.finish_upload_check('incident-photos', '00000000-0000-0000-0000-0000000019a1/i1/b.jpg', 'rejected',
  'JPEG: data after the end of the image');

set local role authenticated;
select is(
  (select string_agg(name, ',') from storage.objects where name like '00000000-0000-0000-0000-0000000019a1/i1/%'),
  '00000000-0000-0000-0000-0000000019a1/i1/a.jpg',
  'a verified file becomes readable; a rejected one never does'
);

set local role postgres;
select ok(
  exists (select 1 from public.audit_log where action = 'upload_rejected'
           and target_id = 'incident-photos/00000000-0000-0000-0000-0000000019a1/i1/b.jpg'
           and actor_id = '00000000-0000-0000-0000-0000000019a1'),
  'a rejected upload is audited against the uploader'
);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
insert into storage.objects (bucket_id, name) values
  ('form-submissions', '00000000-0000-0000-0000-0000000019a1/s1/filled.pdf');
set local role postgres;
select is(
  (select status from public.upload_checks where name = '00000000-0000-0000-0000-0000000019a1/s1/filled.pdf'),
  'clean',
  'files the server itself writes (service role) are trusted'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000019f1');
set local role authenticated;
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('licenses', '00000000-0000-0000-0000-0000000019a1/scan.webp', '00000000-0000-0000-0000-0000000019f1') $$,
  '42501', null,
  'formats that can''t be checked (WebP, HEIC) are refused'
);
set local role postgres;

select is(
  (select string_agg(id, ', ') from storage.buckets
    where allowed_mime_types && array['image/heic', 'image/webp', 'image/svg+xml', 'image/gif']),
  null,
  'no bucket accepts HEIC, WebP, SVG or GIF'
);

select is(
  (select count(*)::int from storage.objects o
    where not exists (select 1 from public.upload_checks c where c.bucket_id = o.bucket_id and c.name = o.name)),
  0,
  'every stored file has a content check (existing files included)'
);

select ok(
  not has_function_privilege('authenticated', 'public.claim_upload_checks(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.finish_upload_check(text, text, text, text)', 'execute'),
  'only the server can record check results'
);

select ok(
  exists (select 1 from pg_trigger where tgname = 'upload_checks_queue' and tgrelid = 'storage.objects'::regclass)
  and pg_get_functiondef('public.storage_objects_queue_check'::regproc) ~ 'call_edge_function\(''verify-upload''',
  'each upload asks the verify-upload function to check it'
);

select ok(
  exists (select 1 from cron.job where jobname = 'verify-uploads'),
  'a job retries checks that are still waiting'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and qual ~ 'upload_is_clean'),
  'a restrictive read policy hides unverified files from everyone but the uploader'
);

select * from finish();
rollback;
