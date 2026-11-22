-- Phase 6 tests: post orders (versions, acknowledgements, clock-in gate),
-- daily activity reports, handover notes and the dar-photos bucket.
-- Run with: pnpm db:test
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

select plan(63);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- Site S at 6.5, 3.4. Officers A, B and suspended officer D are assigned to
-- S; officer C is not.
-- Post orders: PO1 ...f001, PO2 ...f002 (created by the tests below).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006a1', 'p6.officer.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P6 Officer A"}'),
  ('00000000-0000-0000-0000-0000000006b1', 'p6.officer.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P6 Officer B"}'),
  ('00000000-0000-0000-0000-0000000006c1', 'p6.officer.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P6 Officer C"}'),
  ('00000000-0000-0000-0000-0000000006d1', 'p6.suspended@test.local', '{"role":"officer","employment_status":"suspended"}', '{"full_name":"P6 Suspended"}'),
  ('00000000-0000-0000-0000-0000000006e1', 'p6.supervisor@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P6 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000006f1', 'p6.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P6 Admin"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000006a1', 'phone-a', 'android'),
  ('00000000-0000-0000-0000-0000000006b1', 'phone-b', 'ios');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000006c001', 'P6 Client');

insert into public.sites (id, client_id, name, latitude, longitude, clock_in_radius_m) values
  ('00000000-0000-0000-0000-00000006501e', '00000000-0000-0000-0000-00000006c001', 'P6 Site S', 6.5, 3.4, 150),
  ('00000000-0000-0000-0000-00000006502e', '00000000-0000-0000-0000-00000006c001', 'P6 Site T', 6.6, 3.5, 150);

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000006501e', '00000000-0000-0000-0000-0000000006a1'),
  ('00000000-0000-0000-0000-00000006501e', '00000000-0000-0000-0000-0000000006b1'),
  ('00000000-0000-0000-0000-00000006501e', '00000000-0000-0000-0000-0000000006d1');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  -- A1: started 5 minutes ago (live clock-in)
  ('00000000-0000-0000-0000-00000006a001', '00000000-0000-0000-0000-00000006501e', '00000000-0000-0000-0000-0000000006a1', now() - interval '5 minutes', now() + interval '8 hours'),
  -- B0: yesterday; the phone was offline (queued in and out)
  ('00000000-0000-0000-0000-00000006b000', '00000000-0000-0000-0000-00000006501e', '00000000-0000-0000-0000-0000000006b1', now() - interval '30 hours', now() - interval '22 hours'),
  -- B1: ended an hour ago, also offline
  ('00000000-0000-0000-0000-00000006b001', '00000000-0000-0000-0000-00000006501e', '00000000-0000-0000-0000-0000000006b1', now() - interval '9 hours', now() - interval '1 hour');

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
      and relname in ('post_orders', 'post_order_versions', 'post_order_acknowledgements',
                      'daily_activity_reports', 'dar_entries')),
  5,
  'RLS is enabled on every Phase 6 table'
);

select is(
  (select public from storage.buckets where id = 'dar-photos'),
  false,
  'dar-photos bucket exists and is private'
);

select ok(
  not has_function_privilege('anon', 'public.acknowledge_post_order(uuid, integer)', 'execute'),
  'anon cannot call acknowledge_post_order'
);

select ok(
  not has_function_privilege('authenticated', 'public.post_orders_pending(uuid, uuid, timestamptz)', 'execute'),
  'signed-in users cannot call the internal post_orders_pending'
);

select is(
  (select count(*)::int from pg_proc where proname = 'clock_event' and pronamespace = 'public'::regnamespace),
  1,
  'clock_event has a single signature (no leftover overload)'
);

-- ---------------------------------------------------------------------------
-- Publishing post orders
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000006f1');
set local role authenticated;

select lives_ok(
  $$ insert into public.post_orders (id, site_id, title, body, version, published_at)
     values ('00000000-0000-0000-0000-00000006f001', '00000000-0000-0000-0000-00000006501e',
             'Access control', 'Check every ID.', 7, '2000-01-01 00:00:00+00') $$,
  'an admin can create a post order'
);

select is(
  (select version from public.post_orders where id = '00000000-0000-0000-0000-00000006f001'),
  1,
  'a new post order is version 1 (the client value is ignored)'
);

select is(
  (select published_at from public.post_orders where id = '00000000-0000-0000-0000-00000006f001'),
  now(),
  '...published now (the client value is ignored)'
);

update public.post_orders set body = 'Check every ID and log every visitor.'
 where id = '00000000-0000-0000-0000-00000006f001';

select is(
  (select version from public.post_orders where id = '00000000-0000-0000-0000-00000006f001'),
  2,
  'changing the body publishes version 2'
);

update public.post_orders set title = 'Access control'
 where id = '00000000-0000-0000-0000-00000006f001';

select is(
  (select version from public.post_orders where id = '00000000-0000-0000-0000-00000006f001'),
  2,
  'saving without changing title or body keeps the version'
);

select is(
  (select body from public.post_order_versions
    where post_order_id = '00000000-0000-0000-0000-00000006f001' and version = 1),
  'Check every ID.',
  'version 1 is kept in the history'
);

select throws_ok(
  $$ update public.post_orders set site_id = '00000000-0000-0000-0000-00000006502e'
      where id = '00000000-0000-0000-0000-00000006f001' $$,
  '42501', 'A post order can''t be moved to another site',
  'a post order cannot move to another site'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006e1');
set local role authenticated;

select lives_ok(
  $$ insert into public.post_orders (id, site_id, title, body)
     values ('00000000-0000-0000-0000-00000006f002', '00000000-0000-0000-0000-00000006501e',
             'Fire procedure', 'Call 112. Evacuate to the car park.') $$,
  'a supervisor can create a post order'
);

select is(
  (select created_by from public.post_orders where id = '00000000-0000-0000-0000-00000006f002'),
  '00000000-0000-0000-0000-0000000006e1'::uuid,
  'created_by is the signed-in user'
);

-- ---------------------------------------------------------------------------
-- Who can read and write post orders
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006a1');
set local role authenticated;

select is(
  (select count(*)::int from public.post_orders),
  2,
  'an officer sees the post orders of their assigned site'
);

select is(
  (select count(*)::int from public.post_order_versions),
  0,
  'an officer cannot read the version history'
);

select throws_ok(
  $$ insert into public.post_orders (site_id, title, body)
     values ('00000000-0000-0000-0000-00000006501e', 'Mine', 'No') $$,
  '42501', null,
  'an officer cannot create a post order'
);

update public.post_orders set body = 'hacked';

select is(
  (select count(*)::int from public.post_orders where body = 'hacked'),
  0,
  'an officer cannot edit a post order'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006c1');
set local role authenticated;

select is(
  (select count(*)::int from public.post_orders),
  0,
  'an officer not assigned to the site sees none of its post orders'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006d1');
set local role authenticated;

select is(
  (select count(*)::int from public.post_orders),
  0,
  'a suspended officer sees no post orders'
);

-- ---------------------------------------------------------------------------
-- Acknowledging
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006a1');
set local role authenticated;

select throws_ok(
  $$ select public.acknowledge_post_order('00000000-0000-0000-0000-00000006f001', 1) $$,
  'P0001', 'This post order has been updated. Read the new version and acknowledge it',
  'an outdated version cannot be acknowledged'
);

select is(
  (public.acknowledge_post_order('00000000-0000-0000-0000-00000006f001', 2)).version,
  2,
  'an officer acknowledges the current version'
);

select lives_ok(
  $$ select public.acknowledge_post_order('00000000-0000-0000-0000-00000006f001', 2) $$,
  'acknowledging twice is fine'
);

select is(
  (select count(*)::int from public.post_order_acknowledgements),
  1,
  '...and keeps a single record'
);

select throws_ok(
  $$ insert into public.post_order_acknowledgements (post_order_id, version, officer_id)
     values ('00000000-0000-0000-0000-00000006f002', 1, '00000000-0000-0000-0000-0000000006a1') $$,
  '42501', null,
  'an officer cannot write acknowledgements directly'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006c1');
set local role authenticated;

select throws_ok(
  $$ select public.acknowledge_post_order('00000000-0000-0000-0000-00000006f001', 2) $$,
  '42501', 'Post order not found',
  'an officer cannot acknowledge a post order of a site they are not assigned to'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006d1');
set local role authenticated;

select throws_ok(
  $$ select public.acknowledge_post_order('00000000-0000-0000-0000-00000006f001', 2) $$,
  '42501', 'Not allowed',
  'a suspended officer cannot acknowledge'
);

-- ---------------------------------------------------------------------------
-- Clock-in gate
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006a1');
set local role authenticated;

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-00000006a001', 'clock_in', 6.5, 3.4, 10, false, 'phone-a') $$,
  'DG001', 'Read and acknowledge the latest post orders for P6 Site S before you clock in',
  'a live clock-in is refused while a post order is unacknowledged'
);

select lives_ok(
  $$ select public.acknowledge_post_order('00000000-0000-0000-0000-00000006f002', 1) $$,
  'the officer acknowledges the remaining post order'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000006a001', 'clock_in', 6.5, 3.4, 10, false, 'phone-a')).flags,
  array[]::text[],
  '...and can then clock in'
);

select is(
  (select officer_id from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006a001'),
  '00000000-0000-0000-0000-0000000006a1'::uuid,
  'clocking in creates the shift''s daily activity report'
);

-- ---------------------------------------------------------------------------
-- Queued clock events and handover notes
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006b1');
set local role authenticated;

select is(
  (public.clock_event('00000000-0000-0000-0000-00000006b000', 'clock_in', 6.5, 3.4, 10, false, 'phone-b', now() - interval '29 hours 55 minutes', true)).flags,
  array['delayed']::text[],
  'post orders published after a queued clock-in don''t apply to it'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000006b000', 'clock_out', 6.5, 3.4, 10, false, 'phone-b', now() - interval '22 hours', true, '  Gate 2 lock is faulty.  ')).flags,
  array['delayed']::text[],
  'a queued clock-out can carry a handover note'
);

select is(
  (select description from public.dar_entries
    where type = 'handover' and occurred_at = now() - interval '22 hours'),
  'Gate 2 lock is faulty.',
  '...saved (trimmed) as a handover entry at the time of the clock-out'
);

-- Both post orders were published two days ago.
set local role postgres;
update public.post_order_versions set published_at = now() - interval '2 days'
 where post_order_id in ('00000000-0000-0000-0000-00000006f001', '00000000-0000-0000-0000-00000006f002');
select pg_temp.login_as('00000000-0000-0000-0000-0000000006b1');
set local role authenticated;

select is(
  (public.clock_event('00000000-0000-0000-0000-00000006b001', 'clock_in', 6.5, 3.4, 10, false, 'phone-b', now() - interval '8 hours 55 minutes', true)).flags,
  array['delayed', 'post_orders_unread']::text[],
  'a queued clock-in with unacknowledged post orders is accepted but flagged'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000006b001', 'clock_out', 6.5, 3.4, 10, false, 'phone-b', now() - interval '1 hour', true, 'All quiet. Visitor log handed to client.')).flags,
  array['delayed']::text[],
  'a second handover note is left at clock-out'
);

select throws_ok(
  $$ select public.clock_event('00000000-0000-0000-0000-00000006b001', 'clock_in', 6.5, 3.4, 10, false, 'phone-b', null, false, 'note') $$,
  '22023', 'A handover note can only be left at clock-out',
  'a handover note cannot be sent with a clock-in'
);

select throws_ok(
  $$ insert into public.dar_entries (report_id, type, description)
     values ((select id from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006b000'),
             'other', 'Late entry') $$,
  'P0001', 'This shift''s report is closed',
  'entries cannot be added more than 12 hours after the shift ended'
);

-- ---------------------------------------------------------------------------
-- Handover visibility
-- ---------------------------------------------------------------------------

set local role postgres;
select set_config(
  'p6.b1_report',
  (select id::text from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006b001'),
  true
);
select pg_temp.login_as('00000000-0000-0000-0000-0000000006a1');
set local role authenticated;

select is(
  (select count(*)::int from public.shift_handover('00000000-0000-0000-0000-00000006a001')),
  2,
  'the next officer at the site sees the handover notes of the last day'
);

select is(
  (select note || ' / ' || officer_name
     from public.shift_handover('00000000-0000-0000-0000-00000006a001') limit 1),
  'All quiet. Visitor log handed to client. / P6 Officer B',
  '...newest first, with who left it'
);

select is(
  (select count(*)::int from public.daily_activity_reports
    where officer_id = '00000000-0000-0000-0000-0000000006b1'),
  0,
  'an officer cannot read another officer''s reports'
);

select is(
  (select count(*)::int from public.dar_entries
    where officer_id = '00000000-0000-0000-0000-0000000006b1'),
  0,
  '...or their entries'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006c1');
set local role authenticated;

select throws_ok(
  $$ select * from public.shift_handover('00000000-0000-0000-0000-00000006a001') $$,
  '42501', 'Shift not found',
  'an officer cannot read handover notes for someone else''s shift'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006e1');
set local role authenticated;

select is(
  (select count(*)::int from public.dar_entries
    where officer_id = '00000000-0000-0000-0000-0000000006b1'),
  2,
  'a supervisor reads every report entry'
);

select throws_ok(
  $$ insert into public.dar_entries (report_id, type, description)
     values ((select id from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006a001'),
             'other', 'Written by a supervisor') $$,
  '42501', null,
  'a supervisor cannot write in an officer''s report'
);

-- ---------------------------------------------------------------------------
-- Report entries
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006a1');
set local role authenticated;

select lives_ok(
  $$ insert into public.dar_entries (report_id, officer_id, type, description)
     values ((select id from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006a001'),
             '00000000-0000-0000-0000-0000000006b1', 'patrol', 'Perimeter patrol. All secure.') $$,
  'an officer adds an entry to their report'
);

select is(
  (select officer_id from public.dar_entries where description = 'Perimeter patrol. All secure.'),
  '00000000-0000-0000-0000-0000000006a1'::uuid,
  '...owned by them whatever officer_id was sent'
);

select throws_ok(
  $$ insert into public.dar_entries (report_id, type, description)
     values (current_setting('p6.b1_report')::uuid, 'other', 'In B''s report') $$,
  '42501', 'Report not found',
  'an officer cannot add entries to another officer''s report'
);

select throws_ok(
  $$ insert into public.dar_entries (report_id, occurred_at, type, description)
     values ((select id from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006a001'),
             now() + interval '1 hour', 'other', 'Future') $$,
  '22023', 'The time of an entry can''t be in the future',
  'an entry cannot be in the future'
);

select throws_ok(
  $$ insert into public.dar_entries (report_id, occurred_at, type, description)
     values ((select id from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006a001'),
             now() - interval '3 hours', 'other', 'Before') $$,
  '22023', 'The time of an entry must be during the shift',
  'an entry cannot be long before the shift'
);

select throws_ok(
  $$ insert into public.dar_entries (report_id, type, description, photo_path)
     values ((select id from public.daily_activity_reports where shift_id = '00000000-0000-0000-0000-00000006a001'),
             'observation', 'Photo', '00000000-0000-0000-0000-0000000006b1/x/y.jpg') $$,
  '22023', 'Invalid photo',
  'a photo must be in the officer''s own report folder'
);

select lives_ok(
  $$ insert into public.dar_entries (report_id, type, description, photo_path)
     select r.id, 'observation', 'Broken fence by gate 3', r.officer_id || '/' || r.id || '/fence.jpg'
       from public.daily_activity_reports r
      where r.shift_id = '00000000-0000-0000-0000-00000006a001' $$,
  'an entry can have a photo in the report folder'
);

select throws_ok(
  $$ update public.dar_entries set description = 'Edited' $$,
  '42501', null,
  'entries cannot be edited'
);

delete from public.dar_entries;

select is(
  (select count(*)::int from public.dar_entries),
  2,
  'an officer cannot delete entries'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     select 'dar-photos', r.officer_id || '/' || r.id || '/fence.jpg'
       from public.daily_activity_reports r
      where r.shift_id = '00000000-0000-0000-0000-00000006a001' $$,
  'an officer can upload a photo to their own report folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('dar-photos', '00000000-0000-0000-0000-0000000006a1/' || current_setting('p6.b1_report') || '/x.jpg') $$,
  '42501', null,
  'an officer cannot upload to a folder for someone else''s report'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('dar-photos', '00000000-0000-0000-0000-0000000006b1/' || current_setting('p6.b1_report') || '/x.jpg') $$,
  '42501', null,
  'an officer cannot upload to another officer''s folder'
);

select is(
  (public.clock_event('00000000-0000-0000-0000-00000006a001', 'clock_out', 6.5, 3.4, 10, false, 'phone-a', null, false, 'Keys with reception.')).flags,
  array['early_leave']::text[],
  'a live clock-out with a handover note'
);

select is(
  (select count(*)::int from public.dar_entries where type = 'handover'),
  1,
  '...adds a handover entry to the officer''s report'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006f1');
set local role authenticated;

delete from public.dar_entries where description = 'Perimeter patrol. All secure.';

select is(
  (select count(*)::int from public.dar_entries where officer_id = '00000000-0000-0000-0000-0000000006a1'),
  2,
  'an admin can delete an entry'
);

-- ---------------------------------------------------------------------------
-- Retiring a post order
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006e1');
set local role authenticated;

update public.post_orders set archived_at = '2000-01-01 00:00:00+00'
 where id = '00000000-0000-0000-0000-00000006f002';

select is(
  (select archived_at from public.post_orders where id = '00000000-0000-0000-0000-00000006f002'),
  now(),
  'a supervisor can retire a post order (stamped with server time)'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000006a1');
set local role authenticated;

select is(
  (select count(*)::int from public.post_orders),
  1,
  'officers no longer see a retired post order'
);

select throws_ok(
  $$ select public.acknowledge_post_order('00000000-0000-0000-0000-00000006f002', 1) $$,
  'P0001', 'This post order has been withdrawn',
  '...or acknowledge it'
);

select * from finish();
rollback;
