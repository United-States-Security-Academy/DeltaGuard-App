-- Phase 7 tests: incident reports, review workflow, audit log, photos.
-- Run with: pnpm db:test
begin;

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
-- Fixtures (as postgres)
-- Site S (active): officers A, B and suspended D assigned. Site X (inactive):
-- A assigned. Officer C is assigned nowhere.
-- Incidents: I1 ...7e001 (A), I2 ...7e002 (B), I3 ...7e003 (A, invalid
-- attempts), I4 ...7e004 (supervisor), I5 ...7e005 (upload test).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a1', 'p7.officer.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P7 Officer A"}'),
  ('00000000-0000-0000-0000-0000000007b1', 'p7.officer.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P7 Officer B"}'),
  ('00000000-0000-0000-0000-0000000007c1', 'p7.officer.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P7 Officer C"}'),
  ('00000000-0000-0000-0000-0000000007d1', 'p7.suspended@test.local', '{"role":"officer","employment_status":"suspended"}', '{"full_name":"P7 Suspended"}'),
  ('00000000-0000-0000-0000-0000000007e1', 'p7.supervisor@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P7 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000007f1', 'p7.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P7 Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000007c001', 'P7 Client');

insert into public.sites (id, client_id, name, latitude, longitude, active) values
  ('00000000-0000-0000-0000-00000007501e', '00000000-0000-0000-0000-00000007c001', 'P7 Site S', 6.5, 3.4, true),
  ('00000000-0000-0000-0000-00000007502e', '00000000-0000-0000-0000-00000007c001', 'P7 Site X', 6.6, 3.5, false);

insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000007501e', '00000000-0000-0000-0000-0000000007a1'),
  ('00000000-0000-0000-0000-00000007501e', '00000000-0000-0000-0000-0000000007b1'),
  ('00000000-0000-0000-0000-00000007501e', '00000000-0000-0000-0000-0000000007d1'),
  ('00000000-0000-0000-0000-00000007502e', '00000000-0000-0000-0000-0000000007a1');

insert into public.shifts (id, site_id, officer_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000007a001', '00000000-0000-0000-0000-00000007501e', '00000000-0000-0000-0000-0000000007a1', now() - interval '2 hours', now() + interval '6 hours'),
  ('00000000-0000-0000-0000-00000007b001', '00000000-0000-0000-0000-00000007501e', '00000000-0000-0000-0000-0000000007b1', now() - interval '2 hours', now() + interval '6 hours');

-- Photos already uploaded by the phones.
insert into storage.objects (bucket_id, name) values
  ('incident-photos', '00000000-0000-0000-0000-0000000007a1/00000000-0000-0000-0000-00000007e001/p1.jpg'),
  ('incident-photos', '00000000-0000-0000-0000-0000000007a1/00000000-0000-0000-0000-00000007e001/p2.jpg'),
  ('incident-photos', '00000000-0000-0000-0000-0000000007b1/00000000-0000-0000-0000-00000007e002/p1.jpg');

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
      and relname in ('incidents', 'incident_photos', 'incident_status_history')),
  3,
  'RLS is enabled on every Phase 7 table'
);

select is(
  (select public from storage.buckets where id = 'incident-photos'),
  false,
  'incident-photos bucket exists and is private'
);

select ok(
  not has_function_privilege('anon',
    'public.submit_incident(uuid, uuid, uuid, timestamptz, text, public.incident_severity, text, text, boolean, text[])',
    'execute'),
  'anon cannot call submit_incident'
);

select ok(
  not has_table_privilege('authenticated', 'public.incidents', 'insert')
  and not has_table_privilege('authenticated', 'public.incidents', 'update'),
  'signed-in users cannot insert or update incidents directly'
);

-- ---------------------------------------------------------------------------
-- Submitting (officer A)
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000007a1');
set local role authenticated;

select is(
  (public.submit_incident(
    '00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-00000007501e',
    '00000000-0000-0000-0000-00000007a001', now() - interval '30 minutes', 'trespass', 'high',
    '  Man climbed the back fence.  ', 'Unknown male, about 30', true,
    array['00000000-0000-0000-0000-0000000007a1/00000000-0000-0000-0000-00000007e001/p1.jpg']
  )).status::text,
  'submitted',
  'an officer submits a report'
);

select is(
  (public.submit_incident(
    '00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-00000007501e',
    '00000000-0000-0000-0000-00000007a001', now() - interval '30 minutes', 'trespass', 'high',
    'Changed on retry', null, true, '{}'
  )).description,
  'Man climbed the back fence.',
  'a retry of a submitted report returns it unchanged (stored trimmed)'
);

select is(
  (select count(*)::int from public.incident_photos
    where incident_id = '00000000-0000-0000-0000-00000007e001'),
  1,
  'the photo is attached'
);

select is(
  (select to_status::text from public.incident_status_history
    where incident_id = '00000000-0000-0000-0000-00000007e001' and from_status is null
      and changed_by = '00000000-0000-0000-0000-0000000007a1'),
  'submitted',
  'submitting is logged once, by the officer'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'theft', 'low', 'x', null, false,
       array['00000000-0000-0000-0000-0000000007a1/00000000-0000-0000-0000-00000007e003/missing.jpg']) $$,
  'P0001', 'A photo hasn''t finished uploading',
  'a photo that isn''t in storage is refused'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'theft', 'low', 'x', null, false,
       array['00000000-0000-0000-0000-0000000007b1/00000000-0000-0000-0000-00000007e002/p1.jpg']) $$,
  '22023', 'Invalid photo',
  'an officer cannot attach someone else''s photo'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e', null,
       now() + interval '1 hour', 'theft', 'low', 'x', null, false) $$,
  '22023', 'The incident time can''t be in the future',
  'the incident time cannot be in the future'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007502e', null,
       now(), 'theft', 'low', 'x', null, false) $$,
  '42501', 'You are not assigned to this site',
  'a report cannot be filed for an inactive site'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e',
       '00000000-0000-0000-0000-00000007b001', now(), 'theft', 'low', 'x', null, false) $$,
  '42501', 'That shift isn''t yours at this site',
  'a report cannot be linked to someone else''s shift'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'aliens', 'low', 'x', null, false) $$,
  '23514', null,
  'an unknown category is refused'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'theft', 'low', '   ', null, false) $$,
  '22023', 'Describe what happened (10,000 characters at most)',
  'a description is required'
);

select throws_ok(
  $$ update public.incidents set description = 'edited' $$,
  '42501', null,
  'an officer cannot edit a report directly'
);

select throws_ok(
  $$ insert into public.incident_status_history (incident_id, to_status)
     values ('00000000-0000-0000-0000-00000007e001', 'approved') $$,
  '42501', null,
  'nobody can write the audit log directly'
);

-- ---------------------------------------------------------------------------
-- Other officers
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007b1');
set local role authenticated;

select lives_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e002', '00000000-0000-0000-0000-00000007501e',
       '00000000-0000-0000-0000-00000007b001', now() - interval '10 minutes', 'vandalism', 'medium',
       'Graffiti on the gate.', null, false,
       array['00000000-0000-0000-0000-0000000007b1/00000000-0000-0000-0000-00000007e002/p1.jpg']) $$,
  'officer B submits a report'
);

select is(
  (select count(*)::int from public.incidents),
  1,
  'an officer sees only their own reports'
);

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'incident-photos' and name like '00000000-0000-0000-0000-0000000007a1/%'),
  0,
  'an officer cannot see another officer''s photos in storage'
);

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'theft', 'low', 'Overwrite', null, false) $$,
  '42501', 'Incident not found',
  'an officer cannot overwrite another officer''s report'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('incident-photos', '00000000-0000-0000-0000-0000000007a1/00000000-0000-0000-0000-00000007e005/x.jpg') $$,
  '42501', null,
  'an officer cannot upload into another officer''s folder'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007c1');
set local role authenticated;

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'theft', 'low', 'x', null, false) $$,
  '42501', 'You are not assigned to this site',
  'an officer cannot report for a site they are not assigned to'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('incident-photos', '00000000-0000-0000-0000-0000000007c1/00000000-0000-0000-0000-00000007e005/x.jpg') $$,
  'an officer can upload into their own folder'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007d1');
set local role authenticated;

select throws_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e003', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'theft', 'low', 'x', null, false) $$,
  '42501', 'Not allowed',
  'a suspended officer cannot submit'
);

-- ---------------------------------------------------------------------------
-- Review (supervisor)
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007e1');
set local role authenticated;

select is(
  (select count(*)::int from public.incidents
    where id in ('00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-00000007e002')),
  2,
  'staff read every report'
);

select is(
  (public.review_incident('00000000-0000-0000-0000-00000007e001', 'under_review')).status::text,
  'under_review',
  'a supervisor starts reviewing'
);

select throws_ok(
  $$ select public.review_incident('00000000-0000-0000-0000-00000007e001', 'under_review') $$,
  'P0001', 'This report is under review',
  'a report already under review cannot be picked up again'
);

select throws_ok(
  $$ select public.review_incident('00000000-0000-0000-0000-00000007e001', 'returned', '  ') $$,
  '22023', 'Say what the officer needs to change',
  'returning a report needs notes'
);

select is(
  (public.review_incident('00000000-0000-0000-0000-00000007e001', 'returned', 'Add the time the police arrived.')).status::text,
  'returned',
  'a supervisor returns a report with notes'
);

select is(
  (select notes from public.incident_status_history
    where incident_id = '00000000-0000-0000-0000-00000007e001' and to_status = 'returned'),
  'Add the time the police arrived.',
  'the return and its notes are in the audit log'
);

select throws_ok(
  $$ select public.review_incident('00000000-0000-0000-0000-00000007e002', 'submitted') $$,
  '22023', 'Only the officer can submit a report',
  'staff cannot set a report back to submitted'
);

-- ---------------------------------------------------------------------------
-- Officer edits a returned report
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007a1');
set local role authenticated;

select throws_ok(
  $$ select public.review_incident('00000000-0000-0000-0000-00000007e001', 'approved') $$,
  '42501', 'Not allowed',
  'an officer cannot review'
);

select is(
  (public.submit_incident(
    '00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-00000007501e',
    '00000000-0000-0000-0000-00000007a001', now() - interval '30 minutes', 'trespass', 'critical',
    'Man climbed the back fence. Police arrived 20 minutes later.', 'Unknown male, about 30', true,
    array['00000000-0000-0000-0000-0000000007a1/00000000-0000-0000-0000-00000007e001/p2.jpg']
  )).description,
  'Man climbed the back fence. Police arrived 20 minutes later.',
  'an officer edits and resubmits their returned report'
);

select is(
  (select status::text || '/' || severity::text from public.incidents
    where id = '00000000-0000-0000-0000-00000007e001'),
  'submitted/critical',
  '...which is submitted again with the changes'
);

select is(
  (select count(*)::int from public.incident_photos
    where incident_id = '00000000-0000-0000-0000-00000007e001'),
  2,
  '...keeping earlier photos and adding the new one'
);

select is(
  (select count(*)::int from public.incident_status_history
    where incident_id = '00000000-0000-0000-0000-00000007e001'
      and from_status = 'returned' and to_status = 'submitted'
      and changed_by = '00000000-0000-0000-0000-0000000007a1'),
  1,
  'the resubmission is logged'
);

select is(
  (select count(*)::int from public.incident_status_history
    where incident_id = '00000000-0000-0000-0000-00000007e001'),
  4,
  'the officer can read their report''s full history'
);

-- ---------------------------------------------------------------------------
-- Approval is final
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007e1');
set local role authenticated;

select is(
  (public.review_incident('00000000-0000-0000-0000-00000007e001', 'approved')).reviewed_at,
  now(),
  'a supervisor approves the report straight from submitted'
);

select throws_ok(
  $$ select public.review_incident('00000000-0000-0000-0000-00000007e001', 'returned', 'Again') $$,
  'P0001', 'This report is approved',
  'an approved report cannot be returned'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007a1');
set local role authenticated;

select is(
  (public.submit_incident(
    '00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-00000007501e', null,
    now(), 'other', 'low', 'Rewritten after approval', null, false, '{}'
  )).description,
  'Man climbed the back fence. Police arrived 20 minutes later.',
  'an approved report cannot be changed by the officer'
);

select is(
  (select status::text from public.incidents where id = '00000000-0000-0000-0000-00000007e001'),
  'approved',
  '...and stays approved'
);

-- ---------------------------------------------------------------------------
-- Staff filing their own report
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007e1');
set local role authenticated;

select lives_ok(
  $$ select public.submit_incident(
       '00000000-0000-0000-0000-00000007e004', '00000000-0000-0000-0000-00000007501e', null,
       now(), 'medical', 'medium', 'Visitor fainted at reception.', null, false) $$,
  'a supervisor can file a report for any active site'
);

select throws_ok(
  $$ select public.review_incident('00000000-0000-0000-0000-00000007e004', 'approved') $$,
  '42501', 'You can''t review your own report',
  'nobody reviews their own report'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000007f1');
set local role authenticated;

select is(
  (public.review_incident('00000000-0000-0000-0000-00000007e004', 'approved', 'Ok')).status::text,
  'approved',
  'an admin can approve it'
);

select is(
  (select reviewer_id from public.incidents where id = '00000000-0000-0000-0000-00000007e004'),
  '00000000-0000-0000-0000-0000000007f1'::uuid,
  'the reviewer is recorded'
);

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'incident-photos' and name like '00000000-0000-0000-0000-0000000007%'),
  4,
  'staff can read every incident photo in storage'
);

select * from finish();
rollback;
