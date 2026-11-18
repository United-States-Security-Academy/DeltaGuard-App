-- Phase 2 RLS tests: officer details, qualifications, clients, sites,
-- site assignments and the `licenses` storage bucket.
-- Run with: pnpm db:test
begin;

-- The CLI connects as a temporary login role; act as postgres (the table owner) instead.
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
-- Fixtures (inserted as postgres, which bypasses RLS)
--   Officer A  assigned to Site 1
--   Officer B  assigned to Site 2
--   Suspended  assigned to Site 1
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000002a1', 'p2.officer.a@test.local',
     '{"role":"officer","employment_status":"active"}', '{"full_name":"Officer A"}'),
  ('00000000-0000-0000-0000-0000000002a2', 'p2.officer.b@test.local',
     '{"role":"officer","employment_status":"active"}', '{"full_name":"Officer B"}'),
  ('00000000-0000-0000-0000-0000000002b1', 'p2.supervisor@test.local',
     '{"role":"supervisor","employment_status":"active"}', '{"full_name":"Supervisor"}'),
  ('00000000-0000-0000-0000-0000000002c1', 'p2.admin@test.local',
     '{"role":"admin","employment_status":"active"}', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000002d1', 'p2.suspended@test.local',
     '{"role":"officer","employment_status":"suspended"}', '{"full_name":"Suspended"}');

insert into public.officer_details (user_id, employee_number, address, date_hired) values
  ('00000000-0000-0000-0000-0000000002a1', 'P2-A', '1 Test Street', '2026-01-05'),
  ('00000000-0000-0000-0000-0000000002a2', 'P2-B', '2 Test Street', '2026-02-10'),
  ('00000000-0000-0000-0000-0000000002d1', 'P2-D', '4 Test Street', '2026-03-15');

insert into public.qualifications (id, user_id, type, license_number, issued_on, expires_on, document_path) values
  ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000002a1',
     'Security licence', 'LIC-A', '2026-01-01', '2027-01-01', '00000000-0000-0000-0000-0000000002a1/lic-a.pdf'),
  ('00000000-0000-0000-0000-00000000f0a2', '00000000-0000-0000-0000-0000000002a2',
     'Security licence', 'LIC-B', '2026-01-01', '2027-01-01', '00000000-0000-0000-0000-0000000002a2/lic-b.pdf');

insert into public.clients (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'P2 Client One'),
  ('00000000-0000-0000-0000-00000000c002', 'P2 Client Two');

insert into public.sites (id, client_id, name, latitude, longitude, emergency_instructions) values
  ('00000000-0000-0000-0000-00000000501e', '00000000-0000-0000-0000-00000000c001', 'P2 Site 1', 6.524379, 3.379206, 'Call 112'),
  ('00000000-0000-0000-0000-00000000502e', '00000000-0000-0000-0000-00000000c001', 'P2 Site 2', 6.465422, 3.406448, 'Call 112');

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000000501e', '00000000-0000-0000-0000-0000000002a1'),
  ('00000000-0000-0000-0000-00000000502e', '00000000-0000-0000-0000-0000000002a2'),
  ('00000000-0000-0000-0000-00000000501e', '00000000-0000-0000-0000-0000000002d1');

insert into storage.objects (bucket_id, name) values
  ('licenses', '00000000-0000-0000-0000-0000000002a1/lic-a.pdf'),
  ('licenses', '00000000-0000-0000-0000-0000000002a2/lic-b.pdf'),
  ('licenses', '00000000-0000-0000-0000-0000000002d1/lic-d.pdf');

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

-- Fixture rows only, so the counts ignore any real data on the dev project.
create function pg_temp.fixture_files() returns bigint language sql as $$
  select count(*) from storage.objects
   where bucket_id = 'licenses' and name like '00000000-0000-0000-0000-0000000002%'
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
  (select public from storage.buckets where id = 'licenses'),
  false,
  'licenses bucket exists and is private'
);

select is(
  (select clock_in_radius_m from public.sites where id = '00000000-0000-0000-0000-00000000501e'),
  150,
  'clock-in radius defaults to 150 m'
);

-- ---------------------------------------------------------------------------
-- Officer A
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000002a1');
set local role authenticated;

select results_eq(
  'select employee_number from public.officer_details',
  array['P2-A'],
  'officer reads only their own officer details'
);

select results_eq(
  'select license_number from public.qualifications',
  array['LIC-A'],
  'officer reads only their own qualifications'
);

select is(
  (select count(*)::int from public.clients),
  0,
  'officer cannot read clients'
);

select results_eq(
  'select name from public.sites',
  array['P2 Site 1'],
  'officer reads only the site they are assigned to'
);

select is(
  (select count(*)::int from public.site_assignments),
  1,
  'officer reads only their own assignment'
);

select results_eq(
  'select name from storage.objects where bucket_id = ''licenses''',
  array['00000000-0000-0000-0000-0000000002a1/lic-a.pdf'],
  'officer can view only their own license file'
);

select throws_ok(
  $$ insert into public.qualifications (user_id, type)
     values ('00000000-0000-0000-0000-0000000002a1', 'Self-awarded') $$,
  '42501',
  null,
  'officer cannot add qualifications'
);

select throws_ok(
  $$ insert into public.officer_details (user_id, employee_number)
     values ('00000000-0000-0000-0000-0000000002a1', 'X') $$,
  '42501',
  null,
  'officer cannot write officer details'
);

select throws_ok(
  $$ insert into public.site_assignments (site_id, officer_id)
     values ('00000000-0000-0000-0000-00000000502e', '00000000-0000-0000-0000-0000000002a1') $$,
  '42501',
  null,
  'officer cannot assign themselves to another site'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('licenses', '00000000-0000-0000-0000-0000000002a1/fake.pdf') $$,
  '42501',
  null,
  'officer cannot upload license files'
);

-- Updates and deletes that RLS hides affect zero rows; checked below as postgres.
update public.sites set emergency_instructions = 'Hacked'
 where id = '00000000-0000-0000-0000-00000000501e';
update public.qualifications set expires_on = '2099-01-01'
 where user_id = '00000000-0000-0000-0000-0000000002a1';
delete from public.site_assignments
 where officer_id = '00000000-0000-0000-0000-0000000002a1';

set local role postgres;

select is(
  (select emergency_instructions from public.sites where id = '00000000-0000-0000-0000-00000000501e'),
  'Call 112',
  'officer cannot edit their assigned site'
);

select is(
  (select expires_on from public.qualifications where id = '00000000-0000-0000-0000-00000000f0a1'),
  '2027-01-01'::date,
  'officer cannot change their own license expiry'
);

select is(
  (select count(*)::int from public.site_assignments
    where officer_id = '00000000-0000-0000-0000-0000000002a1'),
  1,
  'officer cannot remove their own assignment'
);

-- ---------------------------------------------------------------------------
-- Officer B: same rules, other rows
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000002a2');
set local role authenticated;

select results_eq(
  'select name from public.sites',
  array['P2 Site 2'],
  'a different officer sees only their own site'
);

select is(
  (select count(*)::int from storage.objects
    where name = '00000000-0000-0000-0000-0000000002a1/lic-a.pdf'),
  0,
  'officer cannot view another officer''s license file'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Supervisor
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;

select is(
  (select count(*)::int from public.officer_details where employee_number like 'P2-%'),
  3,
  'supervisor reads all officer details'
);

select is(
  (select count(*)::int from public.qualifications where license_number like 'LIC-%'),
  2,
  'supervisor reads all qualifications'
);

select is(
  (select count(*)::int from public.clients where name like 'P2 %'),
  2,
  'supervisor reads all clients'
);

select is(
  (select count(*)::int from public.sites where name like 'P2 %'),
  2,
  'supervisor reads all sites'
);

select is(
  (select count(*)::int from public.site_assignments
    where site_id in ('00000000-0000-0000-0000-00000000501e', '00000000-0000-0000-0000-00000000502e')),
  3,
  'supervisor reads all assignments'
);

select is(
  pg_temp.fixture_files(),
  3::bigint,
  'supervisor can view all license files'
);

select lives_ok(
  $$ update public.sites
        set emergency_instructions = 'Call the duty manager, then 112',
            clock_in_radius_m = 200
      where id = '00000000-0000-0000-0000-00000000501e' $$,
  'supervisor can edit a site'
);

select throws_ok(
  $$ update public.sites set client_id = '00000000-0000-0000-0000-00000000c002'
      where id = '00000000-0000-0000-0000-00000000501e' $$,
  '42501',
  'Only admins can change sites.client_id',
  'supervisor cannot move a site to another client'
);

select throws_ok(
  $$ insert into public.sites (client_id, name)
     values ('00000000-0000-0000-0000-00000000c001', 'Supervisor site') $$,
  '42501',
  null,
  'supervisor cannot create sites'
);

select throws_ok(
  $$ insert into public.site_assignments (site_id, officer_id)
     values ('00000000-0000-0000-0000-00000000502e', '00000000-0000-0000-0000-0000000002a1') $$,
  '42501',
  null,
  'supervisor cannot assign officers'
);

select throws_ok(
  $$ insert into public.clients (name) values ('Supervisor client') $$,
  '42501',
  null,
  'supervisor cannot create clients'
);

select throws_ok(
  $$ insert into public.qualifications (user_id, type)
     values ('00000000-0000-0000-0000-0000000002a1', 'First aid') $$,
  '42501',
  null,
  'supervisor cannot add qualifications'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('licenses', '00000000-0000-0000-0000-0000000002a1/sup.pdf') $$,
  '42501',
  null,
  'supervisor cannot upload license files'
);

update public.clients set name = 'Renamed by supervisor'
 where id = '00000000-0000-0000-0000-00000000c001';
delete from public.sites where id = '00000000-0000-0000-0000-00000000502e';

set local role postgres;

select is(
  (select emergency_instructions from public.sites where id = '00000000-0000-0000-0000-00000000501e'),
  'Call the duty manager, then 112',
  'supervisor''s site edit was saved'
);

select is(
  (select name from public.clients where id = '00000000-0000-0000-0000-00000000c001'),
  'P2 Client One',
  'supervisor cannot edit clients'
);

select is(
  (select count(*)::int from public.sites where id = '00000000-0000-0000-0000-00000000502e'),
  1,
  'supervisor cannot delete sites'
);

-- ---------------------------------------------------------------------------
-- Suspended officer (has details, an assignment and a license file)
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000002d1');
set local role authenticated;

select is(
  (select count(*)::int from public.officer_details),
  0,
  'suspended officer cannot read their own details'
);

select is(
  (select count(*)::int from public.sites),
  0,
  'suspended officer cannot read their assigned site'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'licenses'),
  0,
  'suspended officer cannot view their own license file'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000002c1');
set local role authenticated;

select lives_ok(
  $$ insert into public.clients (id, name, contact_person, phone, email)
     values ('00000000-0000-0000-0000-00000000c003', 'P2 Client Three', 'Ada', '+2348012345678', 'ada@example.com') $$,
  'admin can create a client'
);

select lives_ok(
  $$ insert into public.sites (id, client_id, name, latitude, longitude, site_contacts)
     values ('00000000-0000-0000-0000-00000000503e', '00000000-0000-0000-0000-00000000c003',
             'P2 Site 3', 6.5, 3.4, '[{"name":"Gate","phone":"+2348000000000"}]') $$,
  'admin can create a site'
);

select lives_ok(
  $$ update public.sites set client_id = '00000000-0000-0000-0000-00000000c002'
      where id = '00000000-0000-0000-0000-00000000503e' $$,
  'admin can move a site to another client'
);

select lives_ok(
  $$ insert into public.site_assignments (site_id, officer_id)
     values ('00000000-0000-0000-0000-00000000503e', '00000000-0000-0000-0000-0000000002a1') $$,
  'admin can assign an officer to a site'
);

select lives_ok(
  $$ insert into public.qualifications (user_id, type, document_path)
     values ('00000000-0000-0000-0000-0000000002a2', 'First aid',
             '00000000-0000-0000-0000-0000000002a2/first-aid.pdf') $$,
  'admin can add a qualification'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('licenses', '00000000-0000-0000-0000-0000000002a2/first-aid.pdf') $$,
  'admin can upload a license file'
);

select lives_ok(
  $$ update public.officer_details set address = '22 New Road'
      where user_id = '00000000-0000-0000-0000-0000000002a2' $$,
  'admin can edit officer details'
);

select throws_ok(
  $$ insert into public.qualifications (user_id, type, document_path)
     values ('00000000-0000-0000-0000-0000000002a1', 'Mismatch',
             '00000000-0000-0000-0000-0000000002a2/not-yours.pdf') $$,
  '23514',
  null,
  'a qualification''s file must be in its owner''s folder'
);

select throws_ok(
  $$ insert into public.sites (client_id, name, latitude)
     values ('00000000-0000-0000-0000-00000000c001', 'Half a location', 6.5) $$,
  '23514',
  null,
  'a site needs both latitude and longitude, or neither'
);

set local role postgres;

-- Officer A now has two sites.
select pg_temp.login_as('00000000-0000-0000-0000-0000000002a1');
set local role authenticated;

select is(
  (select count(*)::int from public.sites),
  2,
  'a new assignment gives the officer access to that site'
);

set local role postgres;

select * from finish();
rollback;
