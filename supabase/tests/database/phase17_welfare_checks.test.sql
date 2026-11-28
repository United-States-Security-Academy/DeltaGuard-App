-- Phase 17 tests: welfare checks (scheduling, the officer's answer, the
-- escalation job, resolution, heartbeats, RLS). Run with: pnpm db:test
--
-- now() is fixed for the transaction; the escalation job takes p_now, so the
-- steps are driven by passing now() + N seconds.
--
-- Site S (policy P: 20-40 min, 60 s to answer, 60 s alarm, 2 calls 150 s
-- apart) and site T (no policy). Officer A works at S (shift A1 now, A2
-- tomorrow); B and C at T. Supervisor S1 is assigned to site S and on duty;
-- supervisor S2 has no site and no shift.
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

select plan(70);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000017a1', 'p17.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P17 Officer A"}'),
  ('00000000-0000-0000-0000-0000000017b1', 'p17.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P17 Officer B"}'),
  ('00000000-0000-0000-0000-0000000017c1', 'p17.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P17 Officer C"}'),
  ('00000000-0000-0000-0000-0000000017e1', 'p17.s1@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P17 Sup One"}'),
  ('00000000-0000-0000-0000-0000000017e2', 'p17.s2@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P17 Sup Two"}'),
  ('00000000-0000-0000-0000-0000000017f1', 'p17.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P17 Admin"}');

update public.profiles set phone = '+12145550101' where id = '00000000-0000-0000-0000-0000000017a1';
update public.profiles set phone = '+12145550199' where id = '00000000-0000-0000-0000-0000000017e1';

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000017a1', 'p17-phone-a', 'ios'),
  ('00000000-0000-0000-0000-0000000017b1', 'p17-phone-b', 'android'),
  ('00000000-0000-0000-0000-0000000017c1', 'p17-phone-c', 'android');
-- Phase 20: mark fixture phones verified, so attendance flags here stay
-- about attendance (device flags have their own tests).
update public.user_devices set integrity_status = 'verified', integrity_checked_at = now();

insert into public.welfare_check_policies (id, name, min_interval_minutes, max_interval_minutes) values
  ('00000000-0000-0000-0000-00000017f001', 'P17 Policy', 20, 40);
-- Night hours around the current local time, so "now" is night for this one.
insert into public.welfare_check_policies (
  id, name, min_interval_minutes, max_interval_minutes, night_start, night_end,
  night_min_interval_minutes, night_max_interval_minutes
)
select '00000000-0000-0000-0000-00000017f002', 'P17 Night', 60, 90,
       ((now() at time zone t.tz) - interval '1 hour')::time,
       ((now() at time zone t.tz) + interval '1 hour')::time, 10, 15
  from (select time_zone as tz from public.settings where id) t;

update public.settings set welfare_policy_id = null where id;

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000017c001', 'P17 Client');
insert into public.sites (id, client_id, name, latitude, longitude, clock_in_radius_m, welfare_policy_id) values
  ('00000000-0000-0000-0000-00000017501e', '00000000-0000-0000-0000-00000017c001', 'P17 Site S', 6.5, 3.4, 150,
   '00000000-0000-0000-0000-00000017f001'),
  ('00000000-0000-0000-0000-00000017502e', '00000000-0000-0000-0000-00000017c001', 'P17 Site T', 6.6, 3.5, 150, null);

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000017501e', '00000000-0000-0000-0000-0000000017a1'),
  ('00000000-0000-0000-0000-00000017501e', '00000000-0000-0000-0000-0000000017e1'),
  ('00000000-0000-0000-0000-00000017502e', '00000000-0000-0000-0000-0000000017b1'),
  ('00000000-0000-0000-0000-00000017502e', '00000000-0000-0000-0000-0000000017c1');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000175a1', '00000000-0000-0000-0000-00000017501e', '00000000-0000-0000-0000-0000000017a1', now() - interval '5 minutes', now() + interval '4 hours'),
  ('00000000-0000-0000-0000-0000000175a2', '00000000-0000-0000-0000-00000017501e', '00000000-0000-0000-0000-0000000017a1', now() + interval '20 hours', now() + interval '24 hours'),
  ('00000000-0000-0000-0000-0000000175b1', '00000000-0000-0000-0000-00000017502e', '00000000-0000-0000-0000-0000000017b1', now() - interval '5 minutes', now() + interval '4 hours'),
  ('00000000-0000-0000-0000-0000000175c1', '00000000-0000-0000-0000-00000017502e', '00000000-0000-0000-0000-0000000017c1', now() - interval '5 minutes', now() + interval '4 hours'),
  -- Supervisor S1 on duty now (so S1 is the on-duty supervisor alerted).
  ('00000000-0000-0000-0000-0000000175e1', '00000000-0000-0000-0000-00000017501e', '00000000-0000-0000-0000-0000000017e1', now() - interval '1 hour', now() + interval '4 hours');

-- Check ids found during the test, readable by every role.
create temp table _ids (k text primary key, id uuid);
grant select on _ids to authenticated, service_role;

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

create function pg_temp.steps(p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_array(escalation_log, '$[*].step') from public.welfare_checks where id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Schema, policies, night hours
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has RLS enabled'
);

select is(
  (select count(*)::int from cron.job where jobname = 'welfare-escalation' and schedule = '* * * * *'),
  1,
  'the escalation job runs every minute'
);

select ok(
  exists (select 1 from public.welfare_check_policies where name = 'Standard'
           and response_seconds = 60 and alarm_seconds = 60 and call_attempts = 2 and call_gap_seconds = 150),
  'a Standard policy is seeded with the default timings'
);

select throws_ok(
  $$ insert into public.welfare_check_policies (name, min_interval_minutes, max_interval_minutes)
     values ('P17 Bad', 60, 30) $$,
  '23514', null,
  'a policy''s max interval can''t be below its min'
);

select is(
  public.welfare_interval_minutes('00000000-0000-0000-0000-00000017f002', now()),
  array[10, 15],
  'during night hours the night interval is used'
);

select is(
  public.welfare_interval_minutes('00000000-0000-0000-0000-00000017f002', now() + interval '12 hours'),
  array[60, 90],
  'outside night hours the day interval is used'
);

-- ---------------------------------------------------------------------------
-- Clock-in creates the first check
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000175a1', 'clock_in', 6.5, 3.4, 5, false, 'p17-phone-a')).accepted,
  'officer A clocks in'
);
select pg_temp.login_as('00000000-0000-0000-0000-0000000017b1');
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000175b1', 'clock_in', 6.6, 3.5, 5, false, 'p17-phone-b')).accepted,
  'officer B clocks in'
);

set local role postgres;
insert into _ids select 'a1', id from public.welfare_checks where shift_id = '00000000-0000-0000-0000-0000000175a1';

select is(
  (select count(*)::int from public.welfare_checks
    where shift_id = '00000000-0000-0000-0000-0000000175a1' and status = 'scheduled'),
  1,
  'clock-in creates exactly one scheduled check'
);

select ok(
  (select scheduled_at between now() + interval '20 minutes' and now() + interval '40 minutes'
          and step_due_at = scheduled_at
     from public.welfare_checks where id = (select id from _ids where k = 'a1')),
  'the first check is at a random time within the policy interval'
);

select is(
  (select count(*)::int from public.welfare_checks where shift_id = '00000000-0000-0000-0000-0000000175b1'),
  0,
  'no policy for the site and no company default: no checks'
);

update public.settings set welfare_policy_id = '00000000-0000-0000-0000-00000017f001' where id;
select pg_temp.login_as('00000000-0000-0000-0000-0000000017c1');
set local role authenticated;
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000175c1', 'clock_in', 6.6, 3.5, 5, false, 'p17-phone-c')).accepted,
  'officer C clocks in'
);
set local role postgres;
select is(
  (select count(*)::int from public.welfare_checks where shift_id = '00000000-0000-0000-0000-0000000175c1'),
  1,
  'a site without its own policy uses the company default'
);
update public.settings set welfare_policy_id = null where id;

select throws_ok(
  $$ insert into public.welfare_checks (shift_id, officer_id, site_id, policy, scheduled_at)
     values ('00000000-0000-0000-0000-0000000175a1', '00000000-0000-0000-0000-0000000017a1',
             '00000000-0000-0000-0000-00000017501e', '{}', now() + interval '2 hours') $$,
  '23505', null,
  'only one check ahead: a second open check for the shift is refused'
);

-- A later check on A's shift tomorrow (as if one had been made in advance).
insert into public.welfare_checks (shift_id, officer_id, site_id, policy, scheduled_at)
values ('00000000-0000-0000-0000-0000000175a2', '00000000-0000-0000-0000-0000000017a1',
        '00000000-0000-0000-0000-00000017501e', '{"response_seconds": 60}', now() + interval '21 hours');

-- ---------------------------------------------------------------------------
-- What the officer can see and answer
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;

select is(
  (select count(*)::int from public.welfare_checks),
  0,
  'an officer can''t read checks that aren''t due yet (neither the next nor later ones)'
);

select results_eq(
  $$ select id from public.get_next_welfare_check() $$,
  $$ select id from _ids where k = 'a1' $$,
  'get_next_welfare_check returns only the next check on the shift in progress'
);

select is(
  (select count(*)::int from public.get_next_welfare_check()),
  1,
  'exactly one next check, never the ones after it'
);

select throws_ok(
  $$ select public.respond_welfare_check((select id from _ids where k = 'a1'), now(), true, false, 'p17-phone-a') $$,
  'P0001', null,
  'a check can''t be answered long before it is due'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017b1');
select throws_ok(
  $$ select public.respond_welfare_check((select id from _ids where k = 'a1'), now(), true, false, 'p17-phone-b') $$,
  '42501', null,
  'an officer can''t answer another officer''s check'
);

set local role postgres;
update public.welfare_checks set scheduled_at = now() - interval '30 seconds', step_due_at = now() - interval '30 seconds'
 where id = (select id from _ids where k = 'a1');

select pg_temp.login_as('00000000-0000-0000-0000-0000000017b1');
set local role authenticated;
select is(
  (select count(*)::int from public.welfare_checks where officer_id = '00000000-0000-0000-0000-0000000017a1'),
  0,
  'an officer can''t read another officer''s checks, even past ones'
);

-- ---------------------------------------------------------------------------
-- Prompt and an answer on time
-- ---------------------------------------------------------------------------

set local role postgres;
select is(public.welfare_run_escalation(now(), false), 1, 'the job moves the due check');

select results_eq(
  $$ select status::text, prompted_at, step_due_at from public.welfare_checks where id = (select id from _ids where k = 'a1') $$,
  $$ values ('prompted', now(), now() + interval '60 seconds') $$,
  'a due check is prompted, with response_seconds to answer'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000017a1' and type = 'welfare_check'),
  1,
  'the officer gets the welfare check push'
);

select is(public.welfare_run_escalation(now(), false), 0, 'running the job again at the same time does nothing');

select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;
select is(
  (select count(*)::int from public.welfare_checks where id = (select id from _ids where k = 'a1')),
  1,
  'the officer can read their own check once it is due'
);

select results_eq(
  $$ select r ->> 'status', (r ->> 'response_seconds')::int, r -> 'response_flags'
       from (select public.respond_welfare_check((select id from _ids where k = 'a1'), now(), true, false, 'p17-phone-a') r) x $$,
  $$ values ('responded', 0, '[]'::jsonb) $$,
  'an answer online is recorded with server time and no flags'
);

select results_eq(
  $$ select r ->> 'status', (r -> 'next_check' ->> 'id') is not null
       from (select public.respond_welfare_check((select id from _ids where k = 'a1'), now(), true, false, 'p17-phone-a') r) x $$,
  $$ values ('responded', true) $$,
  'answering again changes nothing and returns the next check'
);

set local role postgres;
insert into _ids select 'a2', id from public.welfare_checks
 where shift_id = '00000000-0000-0000-0000-0000000175a1' and status = 'scheduled';

select is(
  (select count(*)::int from public.welfare_checks
    where shift_id = '00000000-0000-0000-0000-0000000175a1' and status in ('scheduled', 'prompted', 'alarm', 'calling')),
  1,
  'the answer creates exactly one next check'
);

select ok(
  (select scheduled_at between now() + interval '20 minutes' and now() + interval '40 minutes'
     from public.welfare_checks where id = (select id from _ids where k = 'a2')),
  'the next check is within the policy interval after the answer'
);

select is(
  (select biometric_verified from public.welfare_checks where id = (select id from _ids where k = 'a1')),
  true,
  'biometric verification is recorded'
);

select is(
  pg_temp.steps((select id from _ids where k = 'a1')),
  '["scheduled", "prompted", "responded"]'::jsonb,
  'every step is logged'
);

-- ---------------------------------------------------------------------------
-- Heartbeats
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;
select ok(public.record_device_heartbeat('p17-phone-a', 45, 'background'), 'the registered phone records a heartbeat');
select is(public.record_device_heartbeat('p17-other-phone', 45, 'active'), false, 'another phone''s heartbeat is ignored');

-- ---------------------------------------------------------------------------
-- No answer: alarm, calls, escalation
-- ---------------------------------------------------------------------------

set local role postgres;
update public.welfare_checks set scheduled_at = now() - interval '10 seconds', step_due_at = now() - interval '10 seconds'
 where id = (select id from _ids where k = 'a2');
select public.welfare_run_escalation(now(), false);                          -- prompted
select public.welfare_run_escalation(now() + interval '61 seconds', false);  -- alarm

select results_eq(
  $$ select c.status::text, (select count(*)::int from public.notifications n
                              where n.user_id = c.officer_id and n.type = 'welfare_alarm')
       from public.welfare_checks c where c.id = (select id from _ids where k = 'a2') $$,
  $$ values ('alarm', 1) $$,
  'no answer within response_seconds: alarm, with a loud push to the officer'
);

select public.welfare_run_escalation(now() + interval '122 seconds', false); -- call 1
select results_eq(
  $$ select c.status::text, c.calls_made,
            (select count(*)::int from public.welfare_outbox o
              where o.check_id = c.id and o.kind = 'call' and o.phone = '+12145550101' and o.attempt_no = 1)
       from public.welfare_checks c where c.id = (select id from _ids where k = 'a2') $$,
  $$ values ('calling', 1, 1) $$,
  'after alarm_seconds the first voice call to the officer is queued'
);

set local role service_role;
select is(
  (select count(*)::int from public.claim_welfare_outbox(50) o where o.check_id = (select id from _ids where k = 'a2')),
  1,
  'the Edge Function claims the queued call'
);
select public.finish_welfare_outbox(
  (select id from public.welfare_outbox where check_id = (select id from _ids where k = 'a2') and attempt_no = 1),
  'sent', 'CA-test'
);
select is(
  (select count(*)::int from public.claim_welfare_outbox(50) o where o.check_id = (select id from _ids where k = 'a2')),
  0,
  'a call is never claimed twice'
);

set local role postgres;
select public.welfare_run_escalation(now() + interval '130 seconds', false);
select is(
  (select calls_made from public.welfare_checks where id = (select id from _ids where k = 'a2')),
  1,
  'the next call waits for call_gap_seconds'
);

select public.welfare_run_escalation(now() + interval '273 seconds', false); -- call 2
select public.welfare_run_escalation(now() + interval '273 seconds', false); -- same time again
select results_eq(
  $$ select c.calls_made, (select count(*)::int from public.welfare_outbox o where o.check_id = c.id and o.kind = 'call')
       from public.welfare_checks c where c.id = (select id from _ids where k = 'a2') $$,
  $$ values (2, 2) $$,
  'call 2 is queued once, even when the job runs twice'
);

select public.welfare_run_escalation(now() + interval '424 seconds', false); -- escalate
select results_eq(
  $$ select status::text, '00000000-0000-0000-0000-0000000017e1'::uuid = any (alerted_user_ids),
            '00000000-0000-0000-0000-0000000017e2'::uuid = any (alerted_user_ids), step_due_at
       from public.welfare_checks where id = (select id from _ids where k = 'a2') $$,
  $$ values ('escalated', true, false, null::timestamptz) $$,
  'after the last call: escalated to the on-duty supervisor (not to off-duty ones)'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000017e1' and type = 'welfare_escalated'),
  1,
  'the on-duty supervisor gets the escalation push'
);

select ok(
  (select body like '%P17 Officer A%' and body like '%P17 Site S%' and body like '%battery 45\%%'
          and body like '%app background%' and body like '%maps.google.com/?q=6.5%'
     from public.welfare_outbox
    where check_id = (select id from _ids where k = 'a2') and kind = 'sms' and phone = '+12145550199'),
  'the SMS names the officer and site, with battery, app state and the clock-in location'
);

select public.welfare_run_escalation(now() + interval '500 seconds', false);
select results_eq(
  $$ select (select count(*)::int from public.welfare_outbox
              where check_id = (select id from _ids where k = 'a2') and kind = 'sms' and phone = '+12145550199'),
            (select count(*)::int from public.notifications
              where user_id = '00000000-0000-0000-0000-0000000017e1' and type = 'welfare_escalated') $$,
  $$ values (1, 1) $$,
  'escalation is never sent twice'
);

select is(
  pg_temp.steps((select id from _ids where k = 'a2')),
  '["scheduled", "prompted", "alarm", "call_queued", "call_placed", "call_queued", "escalated"]'::jsonb,
  'every escalation step is logged in order'
);

select ok(
  (select bool_and((e ->> 'at') is not null) from public.welfare_checks c, jsonb_array_elements(c.escalation_log) e
    where c.id = (select id from _ids where k = 'a2')),
  'every log entry has a timestamp'
);

-- ---------------------------------------------------------------------------
-- Staff access and resolution
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000017e1');
set local role authenticated;
select is(
  (select count(*)::int from public.welfare_checks where id = (select id from _ids where k = 'a2')),
  1,
  'a supervisor of the site reads its checks'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017e2');
select is(
  (select count(*)::int from public.welfare_checks where officer_id = '00000000-0000-0000-0000-0000000017a1'),
  0,
  'a supervisor of other sites (not alerted) can''t read them'
);

select throws_ok(
  $$ select public.resolve_welfare_check((select id from _ids where k = 'a2'), 'Not mine') $$,
  '42501', null,
  'a supervisor of other sites can''t resolve them'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017f1');
select cmp_ok(
  (select count(*)::int from public.welfare_checks where officer_id = '00000000-0000-0000-0000-0000000017a1'),
  '>=', 3,
  'admins read every check'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
select throws_ok(
  $$ select public.resolve_welfare_check((select id from _ids where k = 'a2'), 'I was fine') $$,
  '42501', null,
  'an officer can''t resolve their own check'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017e1');
select throws_ok(
  $$ select public.resolve_welfare_check((select id from _ids where k = 'a2'), '  ') $$,
  '22023', null,
  'resolving needs notes'
);

select results_eq(
  $$ select status::text, resolved_by, resolution_notes
       from public.resolve_welfare_check((select id from _ids where k = 'a2'), 'Officer was asleep') $$,
  $$ values ('resolved', '00000000-0000-0000-0000-0000000017e1'::uuid, 'Officer was asleep') $$,
  'the supervisor resolves the escalated check with notes'
);

set local role postgres;
insert into _ids select 'a3', id from public.welfare_checks
 where shift_id = '00000000-0000-0000-0000-0000000175a1' and status = 'scheduled';
select is(
  (select count(*)::int from _ids where k = 'a3'),
  1,
  'after resolution the next check is scheduled (the officer is still on shift)'
);

set local role service_role;
select is(
  (select count(*)::int from public.claim_welfare_outbox(50) o where o.check_id = (select id from _ids where k = 'a2')),
  0,
  'calls and SMS for a resolved check are not sent'
);
set local role postgres;
select cmp_ok(
  (select count(*)::int from public.welfare_outbox where check_id = (select id from _ids where k = 'a2') and status = 'skipped'),
  '>=', 2,
  'they are marked skipped (call 2 and the SMS)'
);

-- ---------------------------------------------------------------------------
-- Late and offline answers
-- ---------------------------------------------------------------------------

update public.welfare_checks
   set status = 'alarm', scheduled_at = now() - interval '4 minutes', prompted_at = now() - interval '3 minutes',
       step_due_at = now() + interval '1 minute'
 where id = (select id from _ids where k = 'a3');
select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;
select results_eq(
  $$ select r ->> 'status', (r ->> 'response_seconds')::int, r -> 'response_flags'
       from (select public.respond_welfare_check((select id from _ids where k = 'a3'), now(), false, false, 'p17-phone-a') r) x $$,
  $$ values ('responded', 180, '["late"]'::jsonb) $$,
  'an answer after response_seconds is flagged late'
);

set local role postgres;
insert into _ids select 'a4', id from public.welfare_checks
 where shift_id = '00000000-0000-0000-0000-0000000175a1' and status = 'scheduled';
update public.welfare_checks
   set status = 'calling', calls_made = 1, scheduled_at = now() - interval '4 minutes',
       prompted_at = now() - interval '3 minutes', step_due_at = now() + interval '1 minute'
 where id = (select id from _ids where k = 'a4');
select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;
select results_eq(
  $$ select r ->> 'status', (r ->> 'response_seconds')::int, r -> 'response_flags'
       from (select public.respond_welfare_check((select id from _ids where k = 'a4'),
                    now() - interval '170 seconds', true, true, 'p17-phone-a') r) x $$,
  $$ values ('responded', 10, '["offline"]'::jsonb) $$,
  'an offline answer counts the phone''s time and is flagged offline (not late)'
);

set local role postgres;
select is(
  (select responded_offline from public.welfare_checks where id = (select id from _ids where k = 'a4')),
  true,
  'responded_offline is recorded'
);

insert into _ids select 'a5', id from public.welfare_checks
 where shift_id = '00000000-0000-0000-0000-0000000175a1' and status = 'scheduled';
update public.welfare_checks set scheduled_at = now() - interval '1 minute', step_due_at = now() - interval '1 minute'
 where id = (select id from _ids where k = 'a5');
select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;
select throws_ok(
  $$ select public.respond_welfare_check((select id from _ids where k = 'a5'), null, true, true, 'p17-phone-a') $$,
  '22023', null,
  'an offline answer needs the time it was given'
);

-- ---------------------------------------------------------------------------
-- Heartbeat visibility, policies, direct writes
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000017b1');
select is(
  (select count(*)::int from public.device_heartbeats where officer_id = '00000000-0000-0000-0000-0000000017a1'),
  0,
  'officers can''t read other officers'' heartbeats'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017e1');
select is(
  (select battery_level from public.device_heartbeats where officer_id = '00000000-0000-0000-0000-0000000017a1'),
  45,
  'the site''s supervisor reads the officer''s heartbeat'
);

select throws_ok(
  $$ insert into public.welfare_check_policies (name) values ('P17 Supervisor policy') $$,
  '42501', null,
  'supervisors can''t create policies'
);

select throws_ok(
  $$ update public.sites set welfare_policy_id = null where id = '00000000-0000-0000-0000-00000017501e' $$,
  '42501', null,
  'supervisors can''t change a site''s welfare policy'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017f1');
select lives_ok(
  $$ insert into public.welfare_check_policies (name, min_interval_minutes, max_interval_minutes)
     values ('P17 Admin policy', 30, 60) $$,
  'admins create policies'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
select is(
  (select count(*)::int from public.welfare_check_policies),
  0,
  'officers can''t read policies'
);

select throws_ok(
  $$ select public.welfare_run_escalation() $$,
  '42501', null,
  'officers can''t run the escalation job'
);

select throws_ok(
  $$ update public.welfare_checks set status = 'resolved' where officer_id = auth.uid() $$,
  '42501', null,
  'officers can''t change checks directly'
);

-- ---------------------------------------------------------------------------
-- Clock-out cancels
-- ---------------------------------------------------------------------------

select ok(
  (public.clock_event('00000000-0000-0000-0000-0000000175a1', 'clock_out', 6.5, 3.4, 5, false, 'p17-phone-a')).accepted,
  'officer A clocks out'
);

set local role postgres;
select results_eq(
  $$ select status::text, step_due_at from public.welfare_checks where id = (select id from _ids where k = 'a5') $$,
  $$ values ('cancelled', null::timestamptz) $$,
  'clock-out cancels the pending check'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000017a1');
set local role authenticated;
select is(
  (select count(*)::int from public.get_next_welfare_check()),
  0,
  'after clock-out there is no next check'
);

select * from finish();
rollback;
