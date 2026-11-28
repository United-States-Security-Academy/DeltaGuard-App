-- Phase 15 tests: forms (templates, fields, assignments, submissions, storage).
-- Run with: pnpm db:test
--
-- Fixtures:
--   Officers A (site 1), B (site 2), C (no site). Supervisor S (site 1),
--   supervisor S2 (no site). Admin D.
--   Templates (all published, version 1 unless noted):
--     T1 ...f001  assigned to A directly
--     T2 ...f002  assigned to site 1
--     T3 ...f003  assigned to the officer role
--     T4 ...f004  assigned to B directly
--     T5 ...f005  assigned to A, then archived
--   Submissions: SA ...5a01 (A, T1, draft), SA2 ...5a02 (A, T2, submitted),
--   SB ...5b01 (B, T4, draft).
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

select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000f00a1', 'p15.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P15 Officer A"}'),
  ('00000000-0000-0000-0000-0000000f00b1', 'p15.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P15 Officer B"}'),
  ('00000000-0000-0000-0000-0000000f00c1', 'p15.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P15 Officer C"}'),
  ('00000000-0000-0000-0000-0000000f00e1', 'p15.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P15 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000f00e2', 'p15.sup2@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P15 Supervisor 2"}'),
  ('00000000-0000-0000-0000-0000000f00f1', 'p15.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P15 Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000f00c0', 'P15 Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-0000000f5101', '00000000-0000-0000-0000-0000000f00c0', 'P15 Site 1'),
  ('00000000-0000-0000-0000-0000000f5102', '00000000-0000-0000-0000-0000000f00c0', 'P15 Site 2');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-0000000f5101', '00000000-0000-0000-0000-0000000f00a1'),
  ('00000000-0000-0000-0000-0000000f5101', '00000000-0000-0000-0000-0000000f00e1'),
  ('00000000-0000-0000-0000-0000000f5102', '00000000-0000-0000-0000-0000000f00b1');

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

-- Templates start as drafts so fields can be added, then are published.
insert into public.form_templates (id, title, original_pdf_path, page_count, page_image_paths)
select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, 'P15 Form ' || n,
       '00000000-0000-0000-0000-00000000f00' || n || '/original.pdf', 1,
       array['00000000-0000-0000-0000-00000000f00' || n || '/page-1.png']
  from generate_series(1, 5) n;

insert into public.form_fields (template_id, key, label, type, required, page, x, y, width, height)
select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, 'guard_name', 'Name', 'text', true,
       1, 0.1, 0.1, 0.5, 0.05
  from generate_series(1, 5) n;

-- Published by the admin (publish_form_template freezes version 1).
select pg_temp.login_as('00000000-0000-0000-0000-0000000f00f1');
set local role authenticated;
select public.publish_form_template(('00000000-0000-0000-0000-00000000f00' || n)::uuid)
  from generate_series(1, 5) n;
set local role postgres;

insert into public.form_assignments (template_id, officer_id, site_id, role) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000f00a1', null, null),
  ('00000000-0000-0000-0000-00000000f002', null, '00000000-0000-0000-0000-0000000f5101', null),
  ('00000000-0000-0000-0000-00000000f003', null, null, 'officer'),
  ('00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-0000000f00b1', null, null),
  ('00000000-0000-0000-0000-00000000f005', '00000000-0000-0000-0000-0000000f00a1', null, null);

update public.form_templates set status = 'archived' where id = '00000000-0000-0000-0000-00000000f005';

insert into public.form_submissions (id, template_id, officer_id, "values") values
  ('00000000-0000-0000-0000-000000005a01', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000f00a1', '{"guard_name":"A"}'),
  ('00000000-0000-0000-0000-000000005b01', '00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-0000000f00b1', '{"guard_name":"B"}');

insert into public.form_submissions (
  id, template_id, officer_id, "values", status, signed_at, submitted_at, filled_pdf_path,
  filled_pdf_sha256
) values (
  '00000000-0000-0000-0000-000000005a02', '00000000-0000-0000-0000-00000000f002',
  '00000000-0000-0000-0000-0000000f00a1', '{"guard_name":"A"}', 'submitted', now(), now(),
  '00000000-0000-0000-0000-0000000f00a1/00000000-0000-0000-0000-000000005a02/filled-1.pdf',
  repeat('ab', 32)
);

insert into storage.objects (bucket_id, name) values
  ('form-templates', '00000000-0000-0000-0000-00000000f001/original.pdf'),
  ('form-templates', '00000000-0000-0000-0000-00000000f004/original.pdf'),
  ('form-templates', '00000000-0000-0000-0000-00000000f005/original.pdf'),
  ('form-submissions', '00000000-0000-0000-0000-0000000f00a1/00000000-0000-0000-0000-000000005a02/filled-1.pdf'),
  ('form-submissions', '00000000-0000-0000-0000-0000000f00b1/00000000-0000-0000-0000-000000005b01/signature-1.png');

-- Fixture files count as already content-checked (phase 19: unchecked files
-- are readable only by their uploader).
update public.upload_checks set status = 'clean' where status = 'pending';


-- ---------------------------------------------------------------------------
-- Schema and template rules (as postgres)
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.form_templates'::regclass, 'public.form_fields'::regclass,
                  'public.form_assignments'::regclass, 'public.form_submissions'::regclass)),
  'RLS is enabled on every forms table'
);

select is(
  (select count(*)::int from storage.buckets
    where id in ('form-templates', 'form-submissions') and not public),
  2,
  'both forms buckets exist and are private'
);

select is(
  (select version from public.form_templates where id = '00000000-0000-0000-0000-00000000f001'),
  1,
  'publishing a draft makes version 1'
);

select ok(
  not has_function_privilege('authenticated',
    'public.complete_form_submission(uuid, jsonb, text, integer, timestamptz, text, text)', 'execute'),
  'only the service role can complete a submission'
);

select throws_ok(
  $$ update public.form_templates set original_pdf_path = '00000000-0000-0000-0000-00000000f005/other.pdf'
      where id = '00000000-0000-0000-0000-00000000f005' $$,
  'P0001',
  null,
  'an archived form''s PDF cannot change'
);

select throws_ok(
  $$ insert into public.form_fields (template_id, key, label, type, page, x, y, width, height)
     values ('00000000-0000-0000-0000-00000000f005', 'extra', 'Extra', 'text', 1, 0, 0, 0.1, 0.1) $$,
  'P0001',
  null,
  'fields of an archived form cannot change'
);

select throws_ok(
  $$ insert into public.form_assignments (template_id, officer_id)
     values ('00000000-0000-0000-0000-00000000f005', '00000000-0000-0000-0000-0000000f00b1') $$,
  'P0001',
  null,
  'an archived form cannot be assigned'
);

select throws_ok(
  $$ insert into public.form_assignments (template_id, officer_id, role)
     values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000f00b1', 'officer') $$,
  '23514',
  null,
  'an assignment names exactly one of officer, site or role'
);

-- ---------------------------------------------------------------------------
-- Officer A
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000f00a1');
set local role authenticated;

select results_eq(
  $$ select id from public.form_templates
      where id::text like '00000000-0000-0000-0000-00000000f00%' order by id $$,
  $$ values ('00000000-0000-0000-0000-00000000f001'::uuid),
            ('00000000-0000-0000-0000-00000000f002'::uuid),
            ('00000000-0000-0000-0000-00000000f003'::uuid) $$,
  'an officer sees forms assigned directly, via their site and via their role'
);

select is_empty(
  $$ select 1 from public.form_templates where id = '00000000-0000-0000-0000-00000000f004' $$,
  'an officer cannot read a form that is not assigned to them'
);

select is_empty(
  $$ select 1 from public.form_templates where id = '00000000-0000-0000-0000-00000000f005' $$,
  'an officer cannot read an archived form, even if assigned'
);

select is_empty(
  $$ select 1 from public.form_template_versions where template_id = '00000000-0000-0000-0000-00000000f004' $$,
  'an officer cannot read the fields of a form not assigned to them'
);

select is(
  (select count(*)::int from public.form_template_versions
    where template_id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f002')),
  2,
  'an officer reads the published versions of forms assigned to them'
);

select is(
  (select count(*)::int from public.form_assignments
    where template_id in ('00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-00000000f005')),
  0,
  'an officer cannot see assignments of other officers or of draft forms'
);

select results_eq(
  $$ select id from public.form_submissions order by id $$,
  $$ values ('00000000-0000-0000-0000-000000005a01'::uuid), ('00000000-0000-0000-0000-000000005a02'::uuid) $$,
  'an officer reads only their own submissions'
);

select is_empty(
  $$ select 1 from public.form_submissions where id = '00000000-0000-0000-0000-000000005b01' $$,
  'an officer cannot read another officer''s submission'
);

select is_empty(
  $$ with u as (update public.form_submissions set "values" = '{"guard_name":"hacked"}'
                 where id = '00000000-0000-0000-0000-000000005b01' returning 1)
     select * from u $$,
  'an officer cannot edit another officer''s submission'
);

select isnt_empty(
  $$ with u as (update public.form_submissions set "values" = '{"guard_name":"A edited"}'
                 where id = '00000000-0000-0000-0000-000000005a01' returning 1)
     select * from u $$,
  'an officer edits their own draft'
);

select is_empty(
  $$ with u as (update public.form_submissions set "values" = '{"guard_name":"late change"}'
                 where id = '00000000-0000-0000-0000-000000005a02' returning 1)
     select * from u $$,
  'an officer cannot edit a submitted form'
);

select throws_ok(
  $$ update public.form_submissions set status = 'submitted'
      where id = '00000000-0000-0000-0000-000000005a01' $$,
  '42501',
  null,
  'an officer cannot submit by changing the status (only generate-filled-pdf can)'
);

select throws_ok(
  $$ update public.form_submissions set filled_pdf_sha256 = repeat('cd', 32)
      where id = '00000000-0000-0000-0000-000000005a01' $$,
  '42501',
  null,
  'an officer cannot set the PDF hash'
);

select throws_ok(
  $$ update public.form_submissions
        set signature_path = '00000000-0000-0000-0000-0000000f00b1/00000000-0000-0000-0000-000000005b01/signature-1.png'
      where id = '00000000-0000-0000-0000-000000005a01' $$,
  '22023',
  null,
  'an officer cannot point their signature at someone else''s file'
);

select throws_ok(
  $$ insert into public.form_submissions (template_id, officer_id)
     values ('00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-0000000f00a1') $$,
  '42501',
  null,
  'an officer cannot start a form that is not assigned to them'
);

select throws_ok(
  $$ insert into public.form_submissions (template_id, officer_id)
     values ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000f00b1') $$,
  '42501',
  null,
  'an officer cannot start a form as someone else'
);

select throws_ok(
  $$ insert into public.form_submissions (template_id, officer_id, status, signed_at, submitted_at,
       filled_pdf_path, filled_pdf_sha256)
     values ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000f00a1',
       'submitted', now(), now(), 'x', repeat('ab', 32)) $$,
  '42501',
  null,
  'an officer cannot create a form that is already submitted'
);

select lives_ok(
  $$ insert into public.form_submissions (id, template_id, officer_id)
     values ('00000000-0000-0000-0000-000000005a03', '00000000-0000-0000-0000-00000000f002',
             '00000000-0000-0000-0000-0000000f00a1') $$,
  'an officer starts a draft of a form assigned to their site'
);

select is(
  (select template_version from public.form_submissions where id = '00000000-0000-0000-0000-000000005a03'),
  1,
  'a new draft records the template version'
);

-- Storage
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'form-templates' and name like '00000000-0000-0000-0000-00000000f00%'),
  1,
  'an officer reads only the files of forms assigned to them (not T4, not archived T5)'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'form-submissions'),
  1,
  'an officer reads only their own submission files'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('form-submissions', '00000000-0000-0000-0000-0000000f00a1/00000000-0000-0000-0000-000000005a01/signature-1.png') $$,
  'an officer uploads a signature into their own draft'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('form-submissions', '00000000-0000-0000-0000-0000000f00a1/00000000-0000-0000-0000-000000005a02/signature-2.png') $$,
  '42501',
  null,
  'an officer cannot upload into a submitted form'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('form-submissions', '00000000-0000-0000-0000-0000000f00a1/00000000-0000-0000-0000-000000005a01/filled-9.pdf') $$,
  '42501',
  null,
  'an officer cannot upload a filled PDF (only the Edge Function can)'
);

select throws_ok(
  $$ select public.review_form_submission('00000000-0000-0000-0000-000000005a02', 'approved', null) $$,
  '42501',
  null,
  'an officer cannot review forms'
);

-- ---------------------------------------------------------------------------
-- Officers B and C
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000f00b1');
set local role authenticated;

select is_empty(
  $$ select 1 from public.form_submissions where officer_id = '00000000-0000-0000-0000-0000000f00a1' $$,
  'officer B cannot read officer A''s submissions'
);

select is_empty(
  $$ select 1 from public.form_templates
      where id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f002') $$,
  'officer B cannot read forms assigned to A or to a site B is not assigned to'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000f00c1');
set local role authenticated;

select results_eq(
  $$ select id from public.form_templates
      where id::text like '00000000-0000-0000-0000-00000000f00%' $$,
  $$ values ('00000000-0000-0000-0000-00000000f003'::uuid) $$,
  'an officer with no site sees only forms assigned to their role'
);

-- ---------------------------------------------------------------------------
-- Supervisors
-- ---------------------------------------------------------------------------

set local role postgres;
-- The officer's signature has passed its content check (phase 19).
update public.upload_checks set status = 'clean' where status = 'pending';
select pg_temp.login_as('00000000-0000-0000-0000-0000000f00e1');
set local role authenticated;

select results_eq(
  $$ select id from public.form_submissions order by id $$,
  $$ values ('00000000-0000-0000-0000-000000005a01'::uuid), ('00000000-0000-0000-0000-000000005a02'::uuid),
            ('00000000-0000-0000-0000-000000005a03'::uuid) $$,
  'a supervisor reads submissions for their sites only (A works at site 1, B does not)'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'form-submissions'),
  2,
  'a supervisor reads submission files for their sites only'
);

select is_empty(
  $$ with u as (update public.form_submissions set "values" = '{}'
                 where id = '00000000-0000-0000-0000-000000005a01' returning 1)
     select * from u $$,
  'a supervisor cannot edit submissions'
);

select throws_ok(
  $$ select public.review_form_submission('00000000-0000-0000-0000-000000005a02', 'returned', '  ') $$,
  '22023',
  null,
  'returning a form needs notes'
);

select throws_ok(
  $$ select public.review_form_submission('00000000-0000-0000-0000-000000005a01', 'approved', null) $$,
  'P0001',
  null,
  'a draft cannot be reviewed'
);

select throws_ok(
  $$ select public.review_form_submission('00000000-0000-0000-0000-000000005b01', 'approved', null) $$,
  '42501',
  null,
  'a supervisor cannot review a form from another site'
);

select is(
  (public.review_form_submission('00000000-0000-0000-0000-000000005a02', 'returned', 'Add the gate number')).status::text,
  'returned',
  'a supervisor returns a submitted form for their site'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000f00e2');
set local role authenticated;

select is_empty(
  $$ select 1 from public.form_submissions $$,
  'a supervisor with no sites reads no submissions'
);

-- ---------------------------------------------------------------------------
-- Officer A again: a returned form is editable
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000f00a1');
set local role authenticated;

select isnt_empty(
  $$ with u as (update public.form_submissions set "values" = '{"guard_name":"A fixed"}'
                 where id = '00000000-0000-0000-0000-000000005a02' returning 1)
     select * from u $$,
  'an officer edits a returned form'
);

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000f00f1');
set local role authenticated;

select is(
  (select count(*)::int from public.form_submissions
    where officer_id in ('00000000-0000-0000-0000-0000000f00a1', '00000000-0000-0000-0000-0000000f00b1')),
  4,
  'an admin reads every submission'
);

select is(
  (select count(*)::int from public.form_templates
    where id::text like '00000000-0000-0000-0000-00000000f00%'),
  5,
  'an admin reads every form, drafts included'
);

select * from finish();
rollback;
