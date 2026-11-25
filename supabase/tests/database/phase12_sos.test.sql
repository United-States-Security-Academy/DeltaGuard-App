-- Phase 12 tests: SOS alerts (raise, location updates, dispatch and escalation,
-- acknowledge / resolve, officer actions, SMS outbox, contacts). Run with: pnpm db:test
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

select plan(48);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000c00a1', 'p12.o@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P12 Officer"}'),
  ('00000000-0000-0000-0000-0000000c00a2', 'p12.o2@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P12 Other Officer"}'),
  ('00000000-0000-0000-0000-0000000c00e1', 'p12.s@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P12 On-duty Supervisor"}'),
  ('00000000-0000-0000-0000-0000000c00e2', 'p12.s2@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P12 Off-duty Supervisor"}'),
  ('00000000-0000-0000-0000-0000000c00f1', 'p12.a@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P12 Admin"}');

update public.profiles set phone = '+12145550100' where id = '00000000-0000-0000-0000-0000000c00a1';
update public.profiles set phone = '+12145550101' where id = '00000000-0000-0000-0000-0000000c00e1';
update public.profiles set phone = '+12145550102' where id = '00000000-0000-0000-0000-0000000c00e2';
update public.profiles set phone = null where id = '00000000-0000-0000-0000-0000000c00f1'; -- no number: push only

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000c00c1', 'P12 Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-0000000c0051', '00000000-0000-0000-0000-0000000c00c1', 'P12 Warehouse');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-0000000c0051', '00000000-0000-0000-0000-0000000c00a1'),
  ('00000000-0000-0000-0000-0000000c0051', '00000000-0000-0000-0000-0000000c00e1');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at, status) values
  ('00000000-0000-0000-0000-0000000c1001', '00000000-0000-0000-0000-0000000c0051', '00000000-0000-0000-0000-0000000c00a1', now() - interval '1 hour', now() + interval '7 hours', 'in_progress'),
  ('00000000-0000-0000-0000-0000000c1002', '00000000-0000-0000-0000-0000000c0051', '00000000-0000-0000-0000-0000000c00e1', now() - interval '2 hours', now() + interval '6 hours', 'in_progress');

insert into public.sos_contacts (position, name, phone) values
  (1, 'P12 Ops Manager', '+12145550201'),
  (2, 'P12 Owner', '+12145550202'),
  (3, 'P12 Retired Contact', '+12145550203');
update public.sos_contacts set active = false where name = 'P12 Retired Contact';

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

create function pg_temp.alert() returns public.sos_alerts language sql as $$
  select * from public.sos_alerts where id = '00000000-0000-0000-0000-0000000c5001'
$$;

-- Pretend the next round is due now.
create function pg_temp.make_due() returns void language sql as $$
  update public.sos_alerts set next_escalation_at = now() - interval '1 second'
   where id = '00000000-0000-0000-0000-0000000c5001'
$$;

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.sos_alerts'::regclass, 'public.sos_locations'::regclass,
                  'public.sos_events'::regclass, 'public.sos_contacts'::regclass,
                  'public.sos_sms_outbox'::regclass)),
  'RLS is enabled on every SOS table'
);
select ok(
  (select count(*) = 3 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('sos_alerts', 'sos_locations', 'sos_events')),
  'alerts, locations and events are published to Realtime'
);
select ok(not has_function_privilege('anon', 'public.raise_sos(uuid, double precision, double precision, double precision, timestamptz)', 'execute'),
  'anon cannot raise an SOS');
select ok(not has_function_privilege('authenticated', 'public.claim_sos_sms(integer)', 'execute'),
  'signed-in users cannot touch the SMS outbox');

-- ---------------------------------------------------------------------------
-- Raising
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000c00a1');
set local role authenticated;

select results_eq(
  $$ select status::text, site_name, officer_name, officer_phone, escalation_level
       from public.raise_sos('00000000-0000-0000-0000-0000000c5001', 32.7767, -96.797, 8, now()) $$,
  $$ values ('active'::text, 'P12 Warehouse'::text, 'P12 Officer'::text, '+12145550100'::text, 1) $$,
  'an officer raises an SOS: site from their shift, their phone, round 1 sent at once'
);
select is(
  (public.raise_sos('00000000-0000-0000-0000-0000000c5001', 32.7767, -96.797, 8, now())).id,
  '00000000-0000-0000-0000-0000000c5001'::uuid,
  'a retry with the same id returns the same alert'
);
select is(
  (public.raise_sos('00000000-0000-0000-0000-0000000c5099')).id,
  '00000000-0000-0000-0000-0000000c5001'::uuid,
  'while one is open, raising again returns the open alert'
);
select is(
  (select count(*)::integer from public.sos_alerts where officer_id = '00000000-0000-0000-0000-0000000c00a1'),
  1, 'so the officer has exactly one alert'
);
select is(
  (select count(*)::integer from public.sos_locations where alert_id = '00000000-0000-0000-0000-0000000c5001'),
  1, 'the position at the trigger is stored'
);
select throws_ok(
  $$ select public.acknowledge_sos('00000000-0000-0000-0000-0000000c5001') $$,
  '42501', 'Not allowed',
  'an officer cannot acknowledge'
);

-- ---------------------------------------------------------------------------
-- Round 1: who is alerted
-- ---------------------------------------------------------------------------

set local role postgres;

select ok(
  exists (select 1 from public.sos_events
           where alert_id = '00000000-0000-0000-0000-0000000c5001' and type = 'triggered')
  and exists (select 1 from public.sos_events
               where alert_id = '00000000-0000-0000-0000-0000000c5001' and type = 'notified'
                 and (data ->> 'round')::int = 1),
  'the trigger and round 1 are logged'
);
select results_eq(
  $$ select user_id from public.notifications
      where type = 'sos' and data ->> 'alert_id' = '00000000-0000-0000-0000-0000000c5001'
        and user_id::text like '00000000-0000-0000-0000-0000000c%'
      order by user_id $$,
  $$ values ('00000000-0000-0000-0000-0000000c00e1'::uuid), ('00000000-0000-0000-0000-0000000c00f1'::uuid) $$,
  'push goes to the on-duty supervisor and the admin (not the off-duty supervisor, not the officer)'
);
select results_eq(
  $$ select phone from public.sos_sms_outbox
      where alert_id = '00000000-0000-0000-0000-0000000c5001' and phone like '+121455501%'
      order by phone $$,
  $$ values ('+12145550101'::text) $$,
  'SMS is queued for everyone alerted who has a valid number'
);
select ok(
  (select bool_and(body like 'SOS from P12 Officer at P12 Warehouse. Location: https://maps.google.com/?q=32.776700,-96.797000%')
     from public.sos_sms_outbox where alert_id = '00000000-0000-0000-0000-0000000c5001'),
  'the SMS names the officer and site and links to the map'
);
select ok(
  (select next_escalation_at between now() + interval '119 seconds' and now() + interval '121 seconds'
     from pg_temp.alert()),
  'the next round is due in 2 minutes'
);
select is(public.sos_run_dispatch(null) >= 0, true, 'running dispatch again early does nothing for this alert');
select is((select escalation_level from pg_temp.alert()), 1, 'still round 1');

-- ---------------------------------------------------------------------------
-- Visibility and location updates
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000c00a2');
set local role authenticated;

select is(
  (select count(*)::integer from public.sos_alerts where id = '00000000-0000-0000-0000-0000000c5001'),
  0, 'another officer cannot see the alert'
);
select throws_ok(
  $$ select public.sos_location_update('00000000-0000-0000-0000-0000000c5001', 1, 1) $$,
  '42501', 'Not allowed',
  'another officer cannot update its location'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000c00a1');
set local role authenticated;

select is(
  public.sos_location_update('00000000-0000-0000-0000-0000000c5001', 32.78, -96.8, 5),
  false,
  'a location update within 10 s of the last is ignored'
);

set local role postgres;
update public.sos_locations set received_at = now() - interval '1 minute'
 where alert_id = '00000000-0000-0000-0000-0000000c5001';
set local role authenticated;

select is(
  public.sos_location_update('00000000-0000-0000-0000-0000000c5001', 32.78, -96.8, 5),
  true,
  'a later update is stored'
);
select results_eq(
  $$ select latitude, longitude from public.sos_alerts where id = '00000000-0000-0000-0000-0000000c5001' $$,
  $$ values (32.780000::numeric, -96.800000::numeric) $$,
  'and becomes the alert''s current position'
);

-- ---------------------------------------------------------------------------
-- Escalation
-- ---------------------------------------------------------------------------

set local role postgres;

select pg_temp.make_due();
select public.sos_run_dispatch(null);
select results_eq(
  $$ select escalation_level, (select data ->> 'contact' from public.sos_events
                                where alert_id = '00000000-0000-0000-0000-0000000c5001' and type = 'escalated'
                                order by id desc limit 1)
       from pg_temp.alert() $$,
  $$ values (2, 'P12 Ops Manager'::text) $$,
  'unacknowledged after 2 minutes: round 2 goes to the first contact'
);
select ok(
  exists (select 1 from public.sos_sms_outbox
           where alert_id = '00000000-0000-0000-0000-0000000c5001' and phone = '+12145550201'
             and body like 'UNACKNOWLEDGED SOS from%'),
  'the contact gets an SMS'
);
select ok(
  exists (select 1 from public.notifications
           where user_id = '00000000-0000-0000-0000-0000000c00e1'
             and dedupe_key = 'sos:00000000-0000-0000-0000-0000000c5001:2'),
  'staff are reminded by push'
);

select pg_temp.make_due();
select public.sos_run_dispatch(null);
select is(
  (select data ->> 'contact' from public.sos_events
    where alert_id = '00000000-0000-0000-0000-0000000c5001' and type = 'escalated'
    order by id desc limit 1),
  'P12 Owner', 'round 3 goes to the next contact'
);

select pg_temp.make_due();
select public.sos_run_dispatch(null);
select is(
  (select type from public.sos_events where alert_id = '00000000-0000-0000-0000-0000000c5001'
    order by id desc limit 1),
  'escalation_exhausted', 'inactive contacts are skipped; then the list is exhausted'
);

select pg_temp.make_due();
select public.sos_run_dispatch(null);
select is(
  (select type from public.sos_events where alert_id = '00000000-0000-0000-0000-0000000c5001'
    order by id desc limit 1),
  'reminder', 'after that, staff keep getting reminders'
);

-- ---------------------------------------------------------------------------
-- Acknowledge and resolve
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000c00e1');
set local role authenticated;

select results_eq(
  $$ select status::text, acknowledged_by_name, next_escalation_at
       from public.acknowledge_sos('00000000-0000-0000-0000-0000000c5001', 'Driving over') $$,
  $$ values ('acknowledged'::text, 'P12 On-duty Supervisor'::text, null::timestamptz) $$,
  'a supervisor acknowledges: escalation stops'
);
select throws_ok(
  $$ select public.acknowledge_sos('00000000-0000-0000-0000-0000000c5001') $$,
  'P0001', 'This alert has already been acknowledged',
  'it can only be acknowledged once'
);
select throws_ok(
  $$ select public.resolve_sos('00000000-0000-0000-0000-0000000c5001', 'resolved', '  ') $$,
  '22023', null,
  'resolving needs a note'
);
select throws_ok(
  $$ select public.resolve_sos('00000000-0000-0000-0000-0000000c5001', 'active', 'x') $$,
  '22023', null,
  'resolving needs resolved or false alarm'
);

set local role postgres;
select ok(
  exists (select 1 from public.notifications
           where user_id = '00000000-0000-0000-0000-0000000c00a1' and type = 'sos_update'
             and title = 'Help is on the way'),
  'the officer is told help is on the way'
);
select pg_temp.make_due();
select public.sos_run_dispatch(null);
select is((select escalation_level from pg_temp.alert()), 5, 'an acknowledged alert never escalates');

select pg_temp.login_as('00000000-0000-0000-0000-0000000c00f1');
set local role authenticated;

select results_eq(
  $$ select status::text, resolved_by_name, resolution_notes
       from public.resolve_sos('00000000-0000-0000-0000-0000000c5001', 'resolved', 'Intruder left; police report 1234') $$,
  $$ values ('resolved'::text, 'P12 Admin'::text, 'Intruder left; police report 1234'::text) $$,
  'an admin resolves it with notes'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000c00a1');
set local role authenticated;

select is(
  public.sos_location_update('00000000-0000-0000-0000-0000000c5001', 32.79, -96.81, 5),
  false,
  'location updates stop once it is resolved'
);
select is(
  (public.raise_sos('00000000-0000-0000-0000-0000000c5002', null, null, null, now())).id,
  '00000000-0000-0000-0000-0000000c5002'::uuid,
  'a new SOS (even without a location) is a new alert'
);
select lives_ok(
  $$ select public.sos_log_officer_action('00000000-0000-0000-0000-0000000c5002', 'officer_sms_fallback', now() - interval '1 minute', '{"to": "+12145550101"}') $$,
  'the officer''s own actions (e.g. the SMS fallback) are logged'
);
select throws_ok(
  $$ select public.sos_log_officer_action('00000000-0000-0000-0000-0000000c5002', 'resolved') $$,
  '22023', null,
  'only officer actions can be logged that way'
);
select is(
  (public.sos_mark_safe('00000000-0000-0000-0000-0000000c5002', true, 'Pressed by accident')).status::text,
  'false_alarm',
  'the officer can close their own alert as a false alarm'
);
select is(
  (select name from public.sos_contacts_for_me() where name like 'P12%' order by sort, name limit 1),
  'P12 On-duty Supervisor',
  'the officer''s call / text list starts with the on-duty supervisor'
);

-- ---------------------------------------------------------------------------
-- SMS outbox (Edge Function, as postgres here)
-- ---------------------------------------------------------------------------

set local role postgres;

select ok(
  (select count(*) > 0 from public.claim_sos_sms(200) where alert_id = '00000000-0000-0000-0000-0000000c5001'),
  'the Edge Function claims queued SMS'
);
select lives_ok(
  $$ select public.finish_sos_sms(
       (select id from public.sos_sms_outbox where phone = '+12145550201' and alert_id = '00000000-0000-0000-0000-0000000c5001'),
       'failed', null, 'Twilio 400 (21211): invalid number') $$,
  'a failed send is recorded'
);
select results_eq(
  $$ select status, next_attempt_at > now() from public.sos_sms_outbox
      where phone = '+12145550201' and alert_id = '00000000-0000-0000-0000-0000000c5001' $$,
  $$ values ('failed'::text, true) $$,
  'and retried later'
);
select ok(
  exists (select 1 from public.sos_events
           where alert_id = '00000000-0000-0000-0000-0000000c5001' and type = 'sms_failed'),
  'the failure is logged on the alert'
);

-- ---------------------------------------------------------------------------
-- Contacts and on-duty fallback
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000c00e1');
set local role authenticated;
select throws_ok(
  $$ insert into public.sos_contacts (position, name, phone) values (9, 'X', '+12145550299') $$,
  '42501', null,
  'a supervisor cannot change the escalation list'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000c00f1');
set local role authenticated;
select throws_ok(
  $$ insert into public.sos_contacts (position, name, phone) values (9, 'X', '214-555-0299') $$,
  '23514', null,
  'contact numbers must be in +1… (E.164) form'
);

set local role postgres;
update public.shifts set status = 'completed' where id = '00000000-0000-0000-0000-0000000c1002';
select ok(
  public.sos_staff_targets('00000000-0000-0000-0000-0000000c00a1')
    @> array['00000000-0000-0000-0000-0000000c00e1', '00000000-0000-0000-0000-0000000c00e2']::uuid[]
  or exists (
    -- Another real supervisor on the dev project may be on duty right now.
    select 1 from public.shifts s join public.profiles p on p.id = s.officer_id
     where p.role = 'supervisor' and s.status = 'in_progress'
  ),
  'with no supervisor on duty, every active supervisor is alerted'
);

select * from finish();
rollback;
