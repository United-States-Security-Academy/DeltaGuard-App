-- Phase 17b tests: welfare checks in the console (per-site switch, pauses,
-- acknowledgement, board, reports). Run with: pnpm db:test
--
-- Site S (policy P) and site T (policy P, checks switched off). Officer A
-- works at S, B at T. Supervisor S1 is assigned to S; S2 has no site.
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

select plan(52);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000017ba01', 'p17b.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P17b Officer A"}'),
  ('00000000-0000-0000-0000-00000017bb01', 'p17b.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P17b Officer B"}'),
  ('00000000-0000-0000-0000-00000017be01', 'p17b.s1@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P17b Sup One"}'),
  ('00000000-0000-0000-0000-00000017be02', 'p17b.s2@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P17b Sup Two"}'),
  ('00000000-0000-0000-0000-00000017bf01', 'p17b.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P17b Admin"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-00000017ba01', 'p17b-phone-a', 'ios'),
  ('00000000-0000-0000-0000-00000017bb01', 'p17b-phone-b', 'android');
-- Phase 20: mark fixture phones verified, so attendance flags here stay
-- about attendance (device flags have their own tests).
update public.user_devices set integrity_status = 'verified', integrity_checked_at = now();

insert into public.welfare_check_policies (id, name, min_interval_minutes, max_interval_minutes) values
  ('00000000-0000-0000-0000-0000017bf001', 'P17b Policy', 20, 40);
update public.settings set welfare_policy_id = null where id;

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000017bc001', 'P17b Client');
insert into public.sites (id, client_id, name, latitude, longitude, clock_in_radius_m, welfare_policy_id, welfare_checks_enabled) values
  ('00000000-0000-0000-0000-0000017b501e', '00000000-0000-0000-0000-0000017bc001', 'P17b Site S', 6.5, 3.4, 150,
   '00000000-0000-0000-0000-0000017bf001', true),
  ('00000000-0000-0000-0000-0000017b502e', '00000000-0000-0000-0000-0000017bc001', 'P17b Site T', 6.6, 3.5, 150,
   '00000000-0000-0000-0000-0000017bf001', false);

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-0000017b501e', '00000000-0000-0000-0000-00000017ba01'),
  ('00000000-0000-0000-0000-0000017b501e', '00000000-0000-0000-0000-00000017be01'),
  ('00000000-0000-0000-0000-0000017b502e', '00000000-0000-0000-0000-00000017bb01');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000017b5a01', '00000000-0000-0000-0000-0000017b501e', '00000000-0000-0000-0000-00000017ba01', now() - interval '5 minutes', now() + interval '4 hours'),
  ('00000000-0000-0000-0000-0000017b5b01', '00000000-0000-0000-0000-0000017b502e', '00000000-0000-0000-0000-00000017bb01', now() - interval '5 minutes', now() + interval '4 hours');

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

create function pg_temp.open_check(p_shift uuid) returns uuid language sql as $$
  select id from public.welfare_checks
   where shift_id = p_shift and status in ('scheduled', 'prompted', 'alarm', 'calling')
$$;

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has RLS enabled'
);

-- ---------------------------------------------------------------------------
-- Per-site switch
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-00000017ba01');
set local role authenticated;
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000017b5a01', 'clock_in', 6.5, 3.4, 5, false, 'p17b-phone-a')).accepted,
  'officer A clocks in'
);
select pg_temp.login_as('00000000-0000-0000-0000-00000017bb01');
select ok(
  (public.clock_event('00000000-0000-0000-0000-0000017b5b01', 'clock_in', 6.6, 3.5, 5, false, 'p17b-phone-b')).accepted,
  'officer B clocks in'
);
set local role postgres;

select is(
  (select count(*)::int from public.welfare_checks where shift_id = '00000000-0000-0000-0000-0000017b5a01'),
  1,
  'checks start at a site with checks on'
);
select is(
  (select count(*)::int from public.welfare_checks where shift_id = '00000000-0000-0000-0000-0000017b5b01'),
  0,
  'no checks at a site with checks switched off, even with a policy'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017be01');
set local role authenticated;
select throws_ok(
  $$ update public.sites set welfare_checks_enabled = true where id = '00000000-0000-0000-0000-0000017b502e' $$,
  '42501', null,
  'a supervisor can''t switch checks on or off for a site'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017bf01');
select lives_ok(
  $$ update public.sites set welfare_checks_enabled = false where id = '00000000-0000-0000-0000-0000017b502e' $$,
  'an admin can switch checks for a site'
);
set local role postgres;

-- ---------------------------------------------------------------------------
-- Board
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-00000017bf01');
set local role authenticated;
select results_eq(
  $$ select site_name, checks_enabled, open_check_id is not null
       from public.welfare_board() where site_name like 'P17b%' order by site_name $$,
  $$ values ('P17b Site S', true, true), ('P17b Site T', false, false) $$,
  'admins see every shift in progress with whether checks are on and the open check'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017be01');
select results_eq(
  $$ select site_name from public.welfare_board() where site_name like 'P17b%' $$,
  $$ values ('P17b Site S') $$,
  'a supervisor sees only their sites on the board'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017be02');
select is(
  (select count(*)::int from public.welfare_board() where site_name like 'P17b%'),
  0,
  'a supervisor with no sites sees nothing'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017ba01');
select is(
  (select count(*)::int from public.welfare_board()),
  0,
  'officers get nothing from the board'
);
set local role postgres;

-- ---------------------------------------------------------------------------
-- Pause and resume
-- ---------------------------------------------------------------------------

insert into _ids values ('c1', pg_temp.open_check('00000000-0000-0000-0000-0000017b5a01'));

select pg_temp.login_as('00000000-0000-0000-0000-00000017be01');
set local role authenticated;
select throws_ok(
  $$ select public.pause_welfare_checks('00000000-0000-0000-0000-0000017b5a01', 'Break') $$,
  '42501', null,
  'supervisors can''t pause checks'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017bf01');
select throws_ok(
  $$ select public.pause_welfare_checks('00000000-0000-0000-0000-0000017b5a01', '  ') $$,
  '22023', null,
  'a pause needs a reason'
);
select throws_ok(
  $$ select public.pause_welfare_checks('00000000-0000-0000-0000-0000017b5a01', 'Break', now() + interval '5 hours') $$,
  '22023', null,
  'the resume time must be before the shift ends'
);
select throws_ok(
  $$ select public.pause_welfare_checks('00000000-0000-0000-0000-0000017b5a01', 'Break', now() - interval '1 minute') $$,
  '22023', null,
  'the resume time must be in the future'
);
select lives_ok(
  $$ select public.pause_welfare_checks('00000000-0000-0000-0000-0000017b5a01', 'Approved meal break', now() + interval '30 minutes') $$,
  'an admin pauses checks for a shift with a reason'
);
select throws_ok(
  $$ select public.pause_welfare_checks('00000000-0000-0000-0000-0000017b5a01', 'Again') $$,
  'P0001', null,
  'a shift can''t be paused twice'
);
set local role postgres;

select results_eq(
  $$ select status::text, escalation_log -> -1 ->> 'reason', escalation_log -> -1 ->> 'notes'
       from public.welfare_checks where id = (select id from _ids where k = 'c1') $$,
  $$ values ('cancelled', 'paused', 'Approved meal break') $$,
  'pausing cancels the open check and logs who paused and why'
);

select results_eq(
  $$ select reason, paused_by, paused_by_name, resumed_at is null
       from public.welfare_pauses where shift_id = '00000000-0000-0000-0000-0000017b5a01' $$,
  $$ values ('Approved meal break', '00000000-0000-0000-0000-00000017bf01'::uuid, 'P17b Admin', true) $$,
  'the pause is recorded with the admin and reason'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-00000017ba01' and type = 'welfare_paused'),
  1,
  'the officer is told checks are paused'
);

select is(
  public.welfare_schedule_next('00000000-0000-0000-0000-0000017b5a01', now()),
  null,
  'no check is scheduled while paused'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017be01');
set local role authenticated;
select results_eq(
  $$ select pause_reason, open_check_id is null from public.welfare_board() where site_name = 'P17b Site S' $$,
  $$ values ('Approved meal break', true) $$,
  'the board shows the pause and no open check'
);
select is(
  (select count(*)::int from public.welfare_pauses where shift_id = '00000000-0000-0000-0000-0000017b5a01'),
  1,
  'the site''s supervisor can read the pause'
);
select pg_temp.login_as('00000000-0000-0000-0000-00000017be02');
select is(
  (select count(*)::int from public.welfare_pauses where shift_id = '00000000-0000-0000-0000-0000017b5a01'),
  0,
  'another supervisor can''t'
);
select pg_temp.login_as('00000000-0000-0000-0000-00000017ba01');
select is(
  (select count(*)::int from public.welfare_pauses),
  0,
  'officers can''t read pauses'
);
select throws_ok(
  $$ insert into public.welfare_pauses (shift_id, officer_id, site_id, reason)
     values ('00000000-0000-0000-0000-0000017b5a01', '00000000-0000-0000-0000-00000017ba01',
             '00000000-0000-0000-0000-0000017b501e', 'x') $$,
  '42501', null,
  'nobody writes pauses directly'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017be01');
select throws_ok(
  $$ select public.resume_welfare_checks('00000000-0000-0000-0000-0000017b5a01') $$,
  '42501', null,
  'supervisors can''t resume checks'
);
select pg_temp.login_as('00000000-0000-0000-0000-00000017bf01');
select is(
  (public.resume_welfare_checks('00000000-0000-0000-0000-0000017b5a01')).resume_reason,
  'manual',
  'an admin resumes checks'
);
select throws_ok(
  $$ select public.resume_welfare_checks('00000000-0000-0000-0000-0000017b5a01') $$,
  'P0001', null,
  'resuming a shift that isn''t paused is refused'
);
set local role postgres;

select ok(
  (select resumed_by = '00000000-0000-0000-0000-00000017bf01' and resumed_by_name = 'P17b Admin'
     from public.welfare_pauses where shift_id = '00000000-0000-0000-0000-0000017b5a01'),
  'the pause records who resumed it'
);
select ok(
  pg_temp.open_check('00000000-0000-0000-0000-0000017b5a01') is not null,
  'resuming schedules the next check'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-00000017ba01' and type = 'welfare_resumed'),
  1,
  'the officer is told checks are back on'
);

-- A pause whose resume time has passed ends on the next job run.
select pg_temp.login_as('00000000-0000-0000-0000-00000017bf01');
set local role authenticated;
select lives_ok(
  $$ select public.pause_welfare_checks('00000000-0000-0000-0000-0000017b5a01', 'Short break', now() + interval '10 minutes') $$,
  'an admin pauses again until a set time'
);
set local role postgres;
update public.welfare_pauses
   set paused_at = now() - interval '20 minutes', resume_at = now() - interval '5 minutes'
 where shift_id = '00000000-0000-0000-0000-0000017b5a01' and resumed_at is null;

select is(public.welfare_resume_due_pauses(), 1, 'the job ends a pause whose time has come');
select ok(
  (select resume_reason = 'scheduled' and resumed_by is null
     from public.welfare_pauses where reason = 'Short break'),
  'it is recorded as a scheduled resume'
);
select ok(
  pg_temp.open_check('00000000-0000-0000-0000-0000017b5a01') is not null,
  'and the next check is scheduled'
);
select is(
  (select count(*)::int from cron.job
    where jobname = 'welfare-escalation' and command like '%welfare_resume_due_pauses%'
      and command like '%welfare_run_escalation%'),
  1,
  'the every-minute job ends due pauses and runs the escalation'
);

-- ---------------------------------------------------------------------------
-- Acknowledging an escalated check
-- ---------------------------------------------------------------------------

insert into _ids values ('c2', pg_temp.open_check('00000000-0000-0000-0000-0000017b5a01'));
update public.welfare_checks
   set status = 'escalated', step_due_at = null, scheduled_at = now() - interval '12 minutes',
       prompted_at = now() - interval '10 minutes',
       alerted_user_ids = array['00000000-0000-0000-0000-00000017be01'::uuid, '00000000-0000-0000-0000-00000017bf01'::uuid],
       escalation_log = escalation_log || '[{"step": "escalated"}]'::jsonb
 where id = (select id from _ids where k = 'c2');

select pg_temp.login_as('00000000-0000-0000-0000-00000017be02');
set local role authenticated;
select throws_ok(
  $$ select public.acknowledge_welfare_check((select id from _ids where k = 'c2')) $$,
  '42501', null,
  'a supervisor who wasn''t alerted and doesn''t supervise the site can''t acknowledge'
);
select pg_temp.login_as('00000000-0000-0000-0000-00000017be01');
select is(
  (public.acknowledge_welfare_check((select id from _ids where k = 'c2'), 'Calling him now')).acknowledged_by,
  '00000000-0000-0000-0000-00000017be01'::uuid,
  'the site''s supervisor acknowledges the escalated check'
);
select pg_temp.login_as('00000000-0000-0000-0000-00000017bf01');
select is(
  (public.acknowledge_welfare_check((select id from _ids where k = 'c2'))).acknowledged_by,
  '00000000-0000-0000-0000-00000017be01'::uuid,
  'a second acknowledgement changes nothing'
);
select throws_ok(
  $$ select public.acknowledge_welfare_check((select id from _ids where k = 'c1')) $$,
  'P0001', null,
  'only escalated checks can be acknowledged'
);
set local role postgres;

select results_eq(
  $$ select escalation_log -> -1 ->> 'step', escalation_log -> -1 ->> 'notes'
       from public.welfare_checks where id = (select id from _ids where k = 'c2') $$,
  $$ values ('acknowledged', 'Calling him now') $$,
  'the acknowledgement is logged with the notes'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-00000017bf01' and type = 'welfare_update'
      and dedupe_key like '%:acknowledged'),
  1,
  'the other alerted staff are told who is handling it'
);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-00000017be01');
set local role authenticated;
select lives_ok(
  $$ select public.resolve_welfare_check((select id from _ids where k = 'c2'), 'Officer was asleep') $$,
  'the supervisor resolves it'
);
set local role postgres;

-- The check made after the resolution was answered on time.
update public.welfare_checks
   set status = 'responded', step_due_at = null, scheduled_at = now() - interval '6 minutes',
       prompted_at = now() - interval '5 minutes', responded_at = now() - interval '4 minutes',
       response_seconds = 60, response_flags = '{}'
 where id = pg_temp.open_check('00000000-0000-0000-0000-0000017b5a01');

create temp table _today as
  select (now() at time zone (select time_zone from public.settings where id))::date as d,
         ((now() at time zone (select time_zone from public.settings where id)) - interval '1 hour')::time as ns,
         ((now() at time zone (select time_zone from public.settings where id)) + interval '1 hour')::time as ne;
grant select on _today to authenticated;

select pg_temp.login_as('00000000-0000-0000-0000-00000017bf01');
set local role authenticated;
select results_eq(
  $$ select group_name, prompted, answered, missed, escalated, avg_response_seconds
       from public.welfare_report((select d - 1 from _today), (select d + 1 from _today), 'officer')
      where group_name like 'P17b%' $$,
  $$ values ('P17b Officer A', 2, 1, 1, 1, 60.0::numeric) $$,
  'per officer: prompted, answered, missed, escalated, average response'
);
select results_eq(
  $$ select group_name, prompted from public.welfare_report((select d - 1 from _today), (select d + 1 from _today), 'site')
      where group_name like 'P17b%' $$,
  $$ values ('P17b Site S', 2) $$,
  'per site'
);
select is(
  (select prompted from public.welfare_report((select d - 1 from _today), (select d + 1 from _today), 'officer',
     'night', (select ns from _today), (select ne from _today)) where group_name like 'P17b%'),
  2,
  'night filter: checks inside the night hours'
);
select is(
  (select count(*)::int from public.welfare_report((select d - 1 from _today), (select d + 1 from _today), 'officer',
     'day', (select ns from _today), (select ne from _today)) where group_name like 'P17b%'),
  0,
  'day filter: none outside them'
);
select is(
  (select count(*)::int from public.welfare_check_rows((select d - 1 from _today), (select d + 1 from _today),
     p_officer_id => '00000000-0000-0000-0000-00000017ba01') where missed and escalated and not answered),
  1,
  'check rows mark the escalated, unanswered check as missed'
);
select throws_ok(
  $$ select * from public.welfare_report(current_date, current_date, 'client') $$,
  '22023', null,
  'reports group by officer or site only'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017be02');
select is(
  (select count(*)::int from public.welfare_report((select d - 1 from _today), (select d + 1 from _today), 'officer')
    where group_name like 'P17b%'),
  0,
  'a supervisor only gets checks for their sites in reports'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000017ba01');
select throws_ok(
  $$ select * from public.welfare_report(current_date, current_date) $$,
  '42501', null,
  'officers can''t run reports'
);

select * from finish();
rollback;
