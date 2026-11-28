-- Phase 9 tests: notification triggers, scheduled alerts, dedupe, inbox RLS,
-- push token handling. Run with: pnpm db:test
--
-- The Vault secret 'deltaguard_functions_url' is not set in tests, so no HTTP
-- call is made: only the inbox rows are checked.
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

select plan(30);

update public.settings set time_zone = 'Africa/Lagos';

-- Only this test's users count in the checks below.
create function pg_temp.n(p_user uuid, p_type text) returns int language sql as $$
  select count(*)::int from public.notifications where user_id = p_user and type = p_type
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'p9.officer.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P9 Officer A"}'),
  ('00000000-0000-0000-0000-0000000009b1', 'p9.officer.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P9 Officer B"}'),
  ('00000000-0000-0000-0000-0000000009d1', 'p9.suspended@test.local', '{"role":"officer","employment_status":"suspended"}', '{"full_name":"P9 Suspended"}'),
  ('00000000-0000-0000-0000-0000000009e1', 'p9.supervisor@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P9 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000009e2', 'p9.supervisor.off@test.local', '{"role":"supervisor","employment_status":"suspended"}', '{"full_name":"P9 Suspended Supervisor"}'),
  ('00000000-0000-0000-0000-0000000009f1', 'p9.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P9 Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000009c001', 'P9 Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-00000009c001', 'P9 Site S');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009a1'),
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009b1'),
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009d1');

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
  (select count(*)::int from pg_class
    where relnamespace = 'public'::regnamespace and relrowsecurity
      and relname in ('notifications', 'push_tickets')),
  2,
  'RLS is enabled on notifications and push_tickets'
);

select ok(
  not has_function_privilege('authenticated', 'public.notify_users(uuid[], text, text, text, jsonb, text)', 'execute'),
  'signed-in users cannot create notifications'
);

-- ---------------------------------------------------------------------------
-- Shift alerts
-- ---------------------------------------------------------------------------

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000009a001', '00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009a1', now() + interval '2 days', now() + interval '2 days 8 hours');

select is(
  (select data ->> 'shift_id' from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009a1' and type = 'shift_assigned'),
  '00000000-0000-0000-0000-00000009a001',
  'a new shift notifies its officer, linking to the shift'
);

insert into public.shifts (site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009b1', now() + interval '3 days', now() + interval '3 days 8 hours'),
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009b1', now() + interval '10 days', now() + interval '10 days 8 hours'),
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009b1', now() + interval '17 days', now() + interval '17 days 8 hours');

select is(
  (select title from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009b1' and type = 'shift_assigned'),
  '3 new shifts',
  'shifts created together (weekly repeat) give one notification per officer'
);

insert into public.shifts (site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009d1', now() + interval '2 days', now() + interval '2 days 8 hours');

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009d1', 'shift_assigned'),
  0,
  'suspended users get no notifications'
);

update public.shifts set starts_at = starts_at + interval '1 hour', status = 'scheduled'
 where id = '00000000-0000-0000-0000-00000009a001';

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009a1', 'shift_changed'),
  1,
  'changing a shift''s time notifies the officer'
);

update public.shifts set notes = 'Bring a torch' where id = '00000000-0000-0000-0000-00000009a001';

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009a1', 'shift_changed'),
  1,
  '...but editing only the notes does not'
);

update public.shifts set officer_id = '00000000-0000-0000-0000-0000000009b1'
 where id = '00000000-0000-0000-0000-00000009a001';

select is(
  (select title from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009a1' and type = 'shift_cancelled'),
  'Shift removed',
  'reassigning a shift tells the old officer it was removed'
);

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009b1', 'shift_assigned'),
  2,
  '...and the new officer it was assigned'
);

update public.shifts set status = 'cancelled' where id = '00000000-0000-0000-0000-00000009a001';

select is(
  (select title from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009b1' and type = 'shift_cancelled'),
  'Shift cancelled',
  'cancelling a shift notifies the officer'
);

-- ---------------------------------------------------------------------------
-- Supervisor alerts
-- ---------------------------------------------------------------------------

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000009a002', '00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009a1', now() - interval '1 hour', now() + interval '7 hours');
update public.shifts set status = 'missed' where id = '00000000-0000-0000-0000-00000009a002';

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009e1', 'clock_in_missed'),
  1,
  'a missed clock-in notifies active supervisors'
);

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009e2', 'clock_in_missed')
    + pg_temp.n('00000000-0000-0000-0000-0000000009f1', 'clock_in_missed'),
  0,
  '...not suspended supervisors or admins'
);

insert into public.attendance_events (shift_id, officer_id, type, latitude, longitude, device_id, flags, accepted, distance_from_site_m) values
  ('00000000-0000-0000-0000-00000009a002', '00000000-0000-0000-0000-0000000009a1', 'clock_in', 6.5, 3.4, 'p', '{late,out_of_range}', true, 420);

select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009e1' and type = 'clock_in_flagged'),
  'P9 Officer A at P9 Site S: late, outside the site radius (420 m).',
  'a flagged clock-in notifies supervisors with the reasons'
);

insert into public.attendance_events (shift_id, officer_id, type, latitude, longitude, device_id, flags, accepted) values
  ('00000000-0000-0000-0000-00000009a002', '00000000-0000-0000-0000-0000000009a1', 'clock_out', 6.5, 3.4, 'p', '{early_leave}', true);

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009e1', 'clock_in_flagged'),
  1,
  'clock-outs don''t raise clock-in alerts'
);

insert into public.incidents (id, site_id, officer_id, occurred_at, category, severity, description, police_called)
values ('00000000-0000-0000-0000-00000009e001', '00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009a1',
        now(), 'suspicious_activity', 'critical', 'Car circling the site', true);

select is(
  (select title || ' | ' || body from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009e1' and type = 'incident_submitted'),
  'CRITICAL: Suspicious Activity reported | P9 Officer A at P9 Site S. Police called.',
  'a submitted incident notifies supervisors'
);

-- ---------------------------------------------------------------------------
-- Scheduled alerts
-- ---------------------------------------------------------------------------

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at, created_at) values
  ('00000000-0000-0000-0000-00000009a003', '00000000-0000-0000-0000-00000009501e', '00000000-0000-0000-0000-0000000009a1', now() + interval '40 minutes', now() + interval '8 hours', now() - interval '1 day');

select is(
  public.notify_upcoming_shifts() >= 1,
  true,
  'a shift starting within the hour gets a reminder'
);

select is(
  (select title from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009a1' and type = 'shift_reminder'),
  'Shift starts in 40 min',
  '...saying how soon'
);

select is(
  pg_temp.n('00000000-0000-0000-0000-0000000009a1', 'shift_reminder') + 0 * public.notify_upcoming_shifts(),
  1,
  'the reminder is sent once, however often the job runs'
);

insert into public.qualifications (id, user_id, type, expires_on) values
  ('00000000-0000-0000-0000-00000009f001', '00000000-0000-0000-0000-0000000009a1', 'Guard licence',
   (now() at time zone 'Africa/Lagos')::date + 20),
  ('00000000-0000-0000-0000-00000009f002', '00000000-0000-0000-0000-0000000009b1', 'First aid',
   (now() at time zone 'Africa/Lagos')::date + 5);

select lives_ok($$ select public.notify_expiring_licences() $$, 'the licence job runs');

select is(
  (select title from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009a1' and type = 'licence_expiring'),
  'Your Guard licence expires in 20 days',
  'the officer is told about a licence expiring within 30 days'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009f1' and type = 'licence_expiring'
      and data ->> 'qualification_id' in ('00000000-0000-0000-0000-00000009f001', '00000000-0000-0000-0000-00000009f002')),
  2,
  '...and admins about each one'
);

select is(
  (select dedupe_key from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000009b1' and type = 'licence_expiring'),
  'licence_expiring:00000000-0000-0000-0000-00000009f002:' || ((now() at time zone 'Africa/Lagos')::date + 5) || ':7',
  'a licence within 7 days gets the 7-day notice'
);

select is(
  public.notify_expiring_licences(),
  0,
  'each notice is sent once'
);

update public.qualifications set expires_on = (now() at time zone 'Africa/Lagos')::date + 25
 where id = '00000000-0000-0000-0000-00000009f001';

select is(
  public.notify_expiring_licences(),
  1 + cardinality(public.active_admin_ids()),
  'a changed expiry date starts over (the officer + every active admin)'
);

-- ---------------------------------------------------------------------------
-- Inbox RLS
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000009a1');
set local role authenticated;

select is(
  (select count(*)::int from public.notifications
    where user_id <> '00000000-0000-0000-0000-0000000009a1'),
  0,
  'users only see their own notifications'
);

update public.notifications set read_at = now() where type = 'shift_reminder';

select is(
  (select read_at from public.notifications where type = 'shift_reminder'),
  now(),
  'a user can mark their notification read'
);

select throws_ok(
  $$ update public.notifications set title = 'Changed' where type = 'shift_reminder' $$,
  '42501', 'Only read_at can be changed',
  '...but not change anything else'
);

select throws_ok(
  $$ insert into public.notifications (user_id, type, title, body)
     values ('00000000-0000-0000-0000-0000000009a1', 'x', 'x', 'x') $$,
  '42501', null,
  'users cannot create notifications'
);

-- ---------------------------------------------------------------------------
-- Push tokens
-- ---------------------------------------------------------------------------

set local role postgres;

insert into public.user_devices (id, user_id, device_id, platform, push_token) values
  ('00000000-0000-0000-0000-00000009de01', '00000000-0000-0000-0000-0000000009a1', 'phone-a', 'android', 'ExponentPushToken[abc123]');
-- Phase 20: mark fixture phones verified, so attendance flags here stay
-- about attendance (device flags have their own tests).
update public.user_devices set integrity_status = 'verified', integrity_checked_at = now();

select throws_ok(
  $$ update public.user_devices set push_token = 'not-a-token' where id = '00000000-0000-0000-0000-00000009de01' $$,
  '23514', null,
  'only Expo push tokens can be stored'
);

update public.user_devices set revoked_at = now() where id = '00000000-0000-0000-0000-00000009de01';

select is(
  (select push_token from public.user_devices where id = '00000000-0000-0000-0000-00000009de01'),
  null,
  'resetting a device removes its push token'
);

select * from finish();
rollback;
