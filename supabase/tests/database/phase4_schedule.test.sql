-- Phase 4 tests: company time zone setting, Realtime publication, and the
-- shift operations the Schedule page relies on. Run with: pnpm db:test
begin;

set local role postgres;

create extension if not exists pgtap with schema extensions;

select set_config(
  'search_path',
  current_setting('search_path') || ', '
    || (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap'),
  true
);

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): officer A assigned to site S; one shift tomorrow.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000004a1', 'p4.officer.a@test.local', '{"role":"officer","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000004b1', 'p4.supervisor@test.local', '{"role":"supervisor","employment_status":"active"}'),
  ('00000000-0000-0000-0000-0000000004c1', 'p4.admin@test.local', '{"role":"admin","employment_status":"active"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000004c001', 'P4 Client');

insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-00000004501e', '00000000-0000-0000-0000-00000004c001', 'P4 Site S');

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000004501e', '00000000-0000-0000-0000-0000000004a1');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000006a01', '00000000-0000-0000-0000-00000004501e',
   '00000000-0000-0000-0000-0000000004a1', now() + interval '1 day', now() + interval '1 day 8 hours');

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
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has RLS enabled'
);

select is(
  (select time_zone from public.settings),
  'Africa/Lagos',
  'time zone defaults to Africa/Lagos'
);

select ok(public.is_valid_time_zone('Europe/London'), 'is_valid_time_zone accepts an IANA zone');
select ok(not public.is_valid_time_zone('Mars/Olympus'), 'is_valid_time_zone rejects an unknown zone');

select set_eq(
  $$ select tablename::text from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('shifts', 'attendance_events') $$,
  array['shifts', 'attendance_events'],
  'shifts and attendance_events are published to Realtime'
);

-- ---------------------------------------------------------------------------
-- Settings: only admins change the time zone, and only to a real zone
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000004b1');
set local role authenticated;

update public.settings set time_zone = 'Europe/London';

set local role postgres;
select is(
  (select time_zone from public.settings),
  'Africa/Lagos',
  'supervisor cannot change the time zone'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000004c1');
set local role authenticated;

select throws_ok(
  $$ update public.settings set time_zone = 'Mars/Olympus' $$,
  '23514',
  null,
  'an unknown time zone is rejected'
);

select lives_ok(
  $$ update public.settings set time_zone = 'Europe/London' $$,
  'admin can change the time zone'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Shift operations used by the Schedule page (as the supervisor)
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000004b1');
set local role authenticated;

select throws_ok(
  $$ insert into public.shifts (site_id, officer_id, starts_at, ends_at)
     values ('00000000-0000-0000-0000-00000004501e', '00000000-0000-0000-0000-0000000004a1',
             now() + interval '1 day 4 hours', now() + interval '1 day 12 hours') $$,
  '23P01',
  null,
  'an overlapping shift for the same officer is rejected'
);

select lives_ok(
  $$ insert into public.shifts (site_id, officer_id, starts_at, ends_at)
     values ('00000000-0000-0000-0000-00000004501e', '00000000-0000-0000-0000-0000000004a1',
             now() + interval '1 day 8 hours', now() + interval '1 day 12 hours') $$,
  'a back-to-back shift (starts when the other ends) is allowed'
);

-- Weekly repeats are one multi-row insert: all or nothing.
select throws_ok(
  $$ insert into public.shifts (site_id, officer_id, starts_at, ends_at) values
       ('00000000-0000-0000-0000-00000004501e', '00000000-0000-0000-0000-0000000004a1',
        now() + interval '7 days', now() + interval '7 days 8 hours'),
       ('00000000-0000-0000-0000-00000004501e', '00000000-0000-0000-0000-0000000004a1',
        now() + interval '1 day 2 hours', now() + interval '1 day 3 hours') $$,
  '23P01',
  null,
  'a repeat batch with one clash inserts nothing'
);

select lives_ok(
  $$ update public.shifts set status = 'cancelled' where id = '00000000-0000-0000-0000-000000006a01' $$,
  'supervisor can cancel a shift'
);

select lives_ok(
  $$ insert into public.shifts (site_id, officer_id, starts_at, ends_at)
     values ('00000000-0000-0000-0000-00000004501e', '00000000-0000-0000-0000-0000000004a1',
             now() + interval '1 day 1 hour', now() + interval '1 day 2 hours') $$,
  'a cancelled shift no longer blocks the time slot'
);

set local role postgres;

select is(
  (select count(*)::int from public.shifts
    where officer_id = '00000000-0000-0000-0000-0000000004a1' and starts_at >= now() + interval '7 days'),
  0,
  'the failed repeat batch left no rows behind'
);

select * from finish();
rollback;
