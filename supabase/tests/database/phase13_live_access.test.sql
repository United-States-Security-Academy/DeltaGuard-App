-- Phase 13 tests: suspending, terminating or demoting someone takes effect at
-- once, even while they still hold an access token issued before the change.
-- Run with: pnpm db:test
--
-- Each user signs in (claims from the real custom_access_token_hook), then an
-- admin change is made as postgres, and the same old claims are reused.
begin;

set local role postgres;

create extension if not exists pgtap with schema extensions;

select set_config(
  'search_path',
  current_setting('search_path') || ', '
    || (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap'),
  true
);

select plan(12);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000d0001', 'p13.officer@test.local',
     '{"role":"officer","employment_status":"active"}', '{"full_name":"P13 Officer"}'),
  ('00000000-0000-0000-0000-0000000d0002', 'p13.admin@test.local',
     '{"role":"admin","employment_status":"active"}', '{"full_name":"P13 Admin"}'),
  ('00000000-0000-0000-0000-0000000d0003', 'p13.admin2@test.local',
     '{"role":"admin","employment_status":"active"}', '{"full_name":"P13 Admin Two"}');

-- Claims as Supabase Auth would issue them right now, kept in a temp table so
-- they can be reused after the profile changes (an old, unexpired token).
create temp table p13_tokens (uid uuid primary key, claims text);
grant select on p13_tokens to authenticated;

insert into p13_tokens
select u.id,
       (public.custom_access_token_hook(jsonb_build_object(
          'user_id', u.id,
          'claims', jsonb_build_object('sub', u.id, 'role', 'authenticated')
        )) -> 'claims')::text
  from auth.users u
 where u.id::text like '00000000-0000-0000-0000-0000000d000%';

create function pg_temp.use_token(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', (select claims from p13_tokens where p13_tokens.uid = $1), true);
$$;

-- ---------------------------------------------------------------------------
-- Before any change: the tokens work
-- ---------------------------------------------------------------------------

set local role authenticated;

select pg_temp.use_token('00000000-0000-0000-0000-0000000d0001');
select ok(public.is_active_user(), 'active officer: is_active_user() is true');
select is(public.auth_role(), 'officer'::public.user_role, 'active officer: auth_role() is officer');
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000d0001'),
  1,
  'active officer reads their own profile'
);

select pg_temp.use_token('00000000-0000-0000-0000-0000000d0002');
select is(public.auth_role(), 'admin'::public.user_role, 'admin: auth_role() is admin');

-- ---------------------------------------------------------------------------
-- Officer suspended; their old token is reused
-- ---------------------------------------------------------------------------

set local role postgres;
update public.profiles set employment_status = 'suspended'
 where id = '00000000-0000-0000-0000-0000000d0001';
set local role authenticated;

select pg_temp.use_token('00000000-0000-0000-0000-0000000d0001');
select ok(not public.is_active_user(), 'suspended officer with an old token: is_active_user() is false');
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000d0001'),
  0,
  'suspended officer with an old token reads nothing, not even their own profile'
);
select is(
  (select count(*)::int from public.settings),
  0,
  'suspended officer with an old token cannot read settings'
);

-- ---------------------------------------------------------------------------
-- Admin demoted to supervisor; their old admin token is reused
-- ---------------------------------------------------------------------------

set local role postgres;
update public.profiles set role = 'supervisor'
 where id = '00000000-0000-0000-0000-0000000d0002';
set local role authenticated;

select pg_temp.use_token('00000000-0000-0000-0000-0000000d0002');
select ok(public.is_active_user(), 'demoted admin is still an active user');
select is(public.auth_role(), null, 'demoted admin with an old admin token: auth_role() is null');
select is(
  (select count(*)::int from public.user_devices),
  0,
  'demoted admin with an old admin token cannot read devices (admin only)'
);
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000d0002' $$,
  '42501',
  null,
  'demoted admin with an old admin token cannot promote themselves back'
);

-- ---------------------------------------------------------------------------
-- An unchanged admin keeps working
-- ---------------------------------------------------------------------------

select pg_temp.use_token('00000000-0000-0000-0000-0000000d0003');
select is(public.auth_role(), 'admin'::public.user_role, 'an unchanged admin keeps admin access');

select * from finish();
rollback;
