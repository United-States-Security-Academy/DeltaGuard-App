-- Phase 1 RLS tests. Run with: pnpm supabase test db
--
-- Each "session" below gets its JWT claims from the real
-- custom_access_token_hook, so these tests cover the hook, the helper
-- functions and the policies together.
begin;

-- The CLI connects as a temporary login role; act as postgres (the table owner) instead.
set local role postgres;

create extension if not exists pgtap with schema extensions;

-- Make pgTAP (installed in the extensions schema) callable without a prefix.
select set_config(
  'search_path',
  current_setting('search_path') || ', '
    || (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap'),
  true
);

select plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer.a@test.local',
     '{"role":"officer","employment_status":"active"}', '{"full_name":"Officer A"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'officer.b@test.local',
     '{"role":"officer","employment_status":"active"}', '{"full_name":"Officer B"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'supervisor@test.local',
     '{"role":"supervisor","employment_status":"active"}', '{"full_name":"Supervisor"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin@test.local',
     '{"role":"admin","employment_status":"active"}', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'suspended@test.local',
     '{"role":"officer","employment_status":"suspended"}', '{"full_name":"Suspended Officer"}'),
  ('00000000-0000-0000-0000-0000000000e1', 'no.metadata@test.local',
     '{"role":"superuser"}', '{"role":"admin"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000000a2', 'officer-b-phone', 'android');
-- Phase 20: mark fixture phones verified, so attendance flags here stay
-- about attendance (device flags have their own tests).
update public.user_devices set integrity_status = 'verified', integrity_checked_at = now();

-- Sets request.jwt.claims for a user the way Supabase Auth would.
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
-- Schema-wide rules
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has RLS enabled'
);

select is(
  (select count(*)::int from public.profiles where id::text like '00000000-0000-0000-0000-0000000000%'),
  6,
  'a profile is created for every new auth user'
);

select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'),
  'officer',
  'invalid app_metadata role and a role in user_metadata are ignored: defaults to officer'
);

-- ---------------------------------------------------------------------------
-- Access token hook
-- ---------------------------------------------------------------------------

select is(
  public.custom_access_token_hook(
    '{"user_id":"00000000-0000-0000-0000-0000000000a1","claims":{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}}'
  ) -> 'claims' ->> 'user_role',
  'officer',
  'hook adds user_role from app_metadata'
);

select is(
  public.custom_access_token_hook(
    '{"user_id":"00000000-0000-0000-0000-0000000000d1","claims":{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}}'
  ) -> 'claims' ->> 'employment_status',
  'suspended',
  'hook adds employment_status from app_metadata'
);

select is(
  public.custom_access_token_hook(
    '{"user_id":"00000000-0000-0000-0000-0000000000c1","claims":{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}}'
  ) -> 'claims' ->> 'role',
  'authenticated',
  'hook leaves the Postgres role claim untouched'
);

-- ---------------------------------------------------------------------------
-- Officer A
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'officer can read their own profile'
);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'),
  0,
  'officer cannot read another officer''s profile'
);

select is(
  (select count(*)::int from public.profiles),
  1,
  'officer sees exactly one profile: their own'
);

select lives_ok(
  $$ update public.profiles set full_name = 'Officer A Renamed', phone = '+2348012345678'
     where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'officer can update their own name and phone'
);

select throws_ok(
  $$ update public.profiles set role = 'admin'
     where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501',
  'Only admins can change role or employment status',
  'officer cannot change their own role'
);

select throws_ok(
  $$ update public.profiles set employment_status = 'active', role = 'supervisor'
     where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501',
  'Only admins can change role or employment status',
  'officer cannot promote themselves to supervisor'
);

update public.profiles set full_name = 'Hacked'
 where id = '00000000-0000-0000-0000-0000000000a2';

select throws_ok(
  $$ insert into public.profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000e1', 'x') $$,
  '42501',
  null,
  'officer cannot insert profiles'
);

select lives_ok(
  $$ insert into public.user_devices (user_id, device_id, platform)
     values ('00000000-0000-0000-0000-0000000000a1', 'officer-a-phone', 'ios') $$,
  'officer can register their own device'
);

select throws_ok(
  $$ insert into public.user_devices (user_id, device_id, platform)
     values ('00000000-0000-0000-0000-0000000000a1', 'officer-a-second-phone', 'android') $$,
  '23505',
  null,
  'officer cannot have a second active device'
);

select throws_ok(
  $$ insert into public.user_devices (user_id, device_id, platform)
     values ('00000000-0000-0000-0000-0000000000a2', 'planted-device', 'android') $$,
  '42501',
  null,
  'officer cannot register a device for someone else'
);

select throws_ok(
  $$ update public.user_devices set revoked_at = now()
     where user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501',
  'Only admins can change or revoke a registered device',
  'officer cannot revoke their own device to register another'
);

select is(
  (select count(*)::int from public.user_devices),
  1,
  'officer sees only their own device'
);

set local role postgres;

select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'),
  'Officer B',
  'officer''s update of another officer''s profile changed nothing'
);

-- ---------------------------------------------------------------------------
-- Supervisor
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;

select is(
  (select count(*)::int from public.profiles
    where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')),
  2,
  'supervisor can read officer profiles'
);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  0,
  'supervisor cannot read admin profiles'
);

select throws_ok(
  $$ update public.profiles set role = 'admin'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501',
  'Only admins can change role or employment status',
  'supervisor cannot change their own role'
);

select is(
  (select count(*)::int from public.user_devices),
  0,
  'supervisor cannot read devices'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Suspended officer
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;

select is(
  (select count(*)::int from public.profiles),
  0,
  'suspended user cannot read any profile, not even their own'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;

select is(
  (select count(*)::int from public.profiles where id::text like '00000000-0000-0000-0000-0000000000%'),
  6,
  'admin can read every profile'
);

select lives_ok(
  $$ update public.profiles set role = 'supervisor'
     where id = '00000000-0000-0000-0000-0000000000a2' $$,
  'admin can change a user''s role'
);

select lives_ok(
  $$ update public.user_devices set revoked_at = now()
     where user_id = '00000000-0000-0000-0000-0000000000a1' and revoked_at is null $$,
  'admin can revoke a device'
);

set local role postgres;

select is(
  (select raw_app_meta_data ->> 'role' from auth.users where id = '00000000-0000-0000-0000-0000000000a2'),
  'supervisor',
  'role change is copied to app_metadata'
);

select * from finish();
rollback;
