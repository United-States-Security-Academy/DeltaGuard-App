-- Phase 15b tests: form versions and publishing, atomic field saving,
-- notifications and form_inbox(). Run with: pnpm db:test
--
-- Officers A (site 1), B (site 2), C (no site); supervisor S (site 1); admin D.
-- T1 ...e001: published v1, assigned to A, due yesterday.
-- T2 ...e002: published v1, assigned to the officer role.
-- T6 ...e006: draft with a PDF and no fields.
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

select plan(24);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000fb0a1', 'p15b.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P15b Officer A"}'),
  ('00000000-0000-0000-0000-0000000fb0b1', 'p15b.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P15b Officer B"}'),
  ('00000000-0000-0000-0000-0000000fb0c1', 'p15b.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P15b Officer C"}'),
  ('00000000-0000-0000-0000-0000000fb0e1', 'p15b.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P15b Supervisor"}'),
  ('00000000-0000-0000-0000-0000000fb0f1', 'p15b.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P15b Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000fb0c0', 'P15b Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-0000000fb101', '00000000-0000-0000-0000-0000000fb0c0', 'P15b Site 1'),
  ('00000000-0000-0000-0000-0000000fb102', '00000000-0000-0000-0000-0000000fb0c0', 'P15b Site 2');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-0000000fb101', '00000000-0000-0000-0000-0000000fb0a1'),
  ('00000000-0000-0000-0000-0000000fb101', '00000000-0000-0000-0000-0000000fb0e1'),
  ('00000000-0000-0000-0000-0000000fb102', '00000000-0000-0000-0000-0000000fb0b1');

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

insert into public.form_templates (id, title, original_pdf_path, page_count, page_image_paths) values
  ('00000000-0000-0000-0000-00000000e001', 'P15b Patrol log', '00000000-0000-0000-0000-00000000e001/u1/original.pdf', 1, array['00000000-0000-0000-0000-00000000e001/u1/page-1.png']),
  ('00000000-0000-0000-0000-00000000e002', 'P15b Uniform check', '00000000-0000-0000-0000-00000000e002/u1/original.pdf', 1, array['00000000-0000-0000-0000-00000000e002/u1/page-1.png']),
  ('00000000-0000-0000-0000-00000000e006', 'P15b Empty', '00000000-0000-0000-0000-00000000e006/u1/original.pdf', 1, array['00000000-0000-0000-0000-00000000e006/u1/page-1.png']);

insert into public.form_fields (template_id, key, label, type, required, page, x, y, width, height) values
  ('00000000-0000-0000-0000-00000000e001', 'gate', 'Gate', 'text', true, 1, 0.1, 0.1, 0.4, 0.05),
  ('00000000-0000-0000-0000-00000000e002', 'ok', 'Uniform OK', 'checkbox', true, 1, 0.1, 0.1, 0.05, 0.05);

-- ---------------------------------------------------------------------------
-- Publishing and versions (admin)
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-0000000fb0f1');
set local role authenticated;

select is(public.publish_form_template('00000000-0000-0000-0000-00000000e001'), 1, 'first publish is version 1');
select is(public.publish_form_template('00000000-0000-0000-0000-00000000e002'), 1, 'second form, version 1');

select throws_ok(
  $$ select public.publish_form_template('00000000-0000-0000-0000-00000000e001') $$,
  'P0001',
  'Nothing has changed since version 1',
  'publishing again without changes is refused'
);

select throws_ok(
  $$ select public.publish_form_template('00000000-0000-0000-0000-00000000e006') $$,
  'P0001',
  'Add at least one field before publishing',
  'a form needs at least one field to publish'
);

select throws_ok(
  $$ update public.form_templates set status = 'published' where id = '00000000-0000-0000-0000-00000000e006' $$,
  'P0001',
  'Publish the form to make it available',
  'setting the status by hand does not publish'
);

select throws_ok(
  $$ update public.form_templates set status = 'draft' where id = '00000000-0000-0000-0000-00000000e001' $$,
  'P0001',
  null,
  'a published form cannot go back to draft'
);

select throws_ok(
  $$ insert into public.form_templates (title, status) values ('Sneaky', 'published') $$,
  'P0001',
  null,
  'a form cannot be created already published'
);

select is(
  public.replace_form_fields('00000000-0000-0000-0000-00000000e006',
    '[{"key":"a","label":"A","type":"text","required":false,"page":1,"x":0.1,"y":0.1,"width":0.2,"height":0.05,"font_size":10,"sort_order":0,"acroform_name":null},
      {"key":"b","label":"B","type":"select","options":["Yes","No"],"required":true,"page":1,"x":0.1,"y":0.3,"width":0.2,"height":0.05,"font_size":10,"sort_order":1,"acroform_name":null}]'::jsonb),
  2,
  'replace_form_fields saves the whole list'
);

select throws_ok(
  $$ select public.replace_form_fields('00000000-0000-0000-0000-00000000e006',
       '[{"key":"Bad Key","label":"X","type":"text","page":1,"x":0,"y":0,"width":0.1,"height":0.1}]'::jsonb) $$,
  '23514',
  null,
  'an invalid field is refused'
);

select is(
  (select count(*)::int from public.form_fields where template_id = '00000000-0000-0000-0000-00000000e006'),
  2,
  '...and the previous fields are untouched (one transaction)'
);

-- Edit the published T1's working copy, then republish.
select lives_ok(
  $$ insert into public.form_fields (template_id, key, label, type, page, x, y, width, height)
     values ('00000000-0000-0000-0000-00000000e001', 'notes', 'Notes', 'multiline', 1, 0.1, 0.3, 0.8, 0.2) $$,
  'a published form''s working copy can be edited'
);

-- ---------------------------------------------------------------------------
-- Assignments notify; officers see only the frozen version
-- ---------------------------------------------------------------------------

insert into public.form_assignments (id, template_id, officer_id, due_at) values
  ('00000000-0000-0000-0000-0000000fba01', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000fb0a1', now() - interval '1 day');
insert into public.form_assignments (id, template_id, role) values
  ('00000000-0000-0000-0000-0000000fba02', '00000000-0000-0000-0000-00000000e002', 'officer');

set local role postgres;

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000fb0a1' and type = 'form_assigned'),
  2,
  'officer A is notified of the direct and the role assignment'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'form_assigned' and data ->> 'assignment_id' = '00000000-0000-0000-0000-0000000fba02'
      and user_id in ('00000000-0000-0000-0000-0000000fb0a1', '00000000-0000-0000-0000-0000000fb0b1',
                      '00000000-0000-0000-0000-0000000fb0c1', '00000000-0000-0000-0000-0000000fb0e1')),
  3,
  'a role assignment notifies every officer, not supervisors'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000fb0a1');
set local role authenticated;

select is(
  (select jsonb_array_length(fields) from public.form_template_versions
    where template_id = '00000000-0000-0000-0000-00000000e001' and version = 1),
  1,
  'officers see the published version (1 field), not the unpublished edit'
);

select is_empty(
  $$ select 1 from public.form_fields $$,
  'officers cannot read the working copy of any form'
);

select throws_ok(
  $$ select public.publish_form_template('00000000-0000-0000-0000-00000000e001') $$,
  '42501',
  null,
  'officers cannot publish'
);

insert into public.form_submissions (id, template_id, officer_id, assignment_id, "values") values
  ('00000000-0000-0000-0000-0000000fb5a1', '00000000-0000-0000-0000-00000000e001',
   '00000000-0000-0000-0000-0000000fb0a1', '00000000-0000-0000-0000-0000000fba01', '{"gate":"North"}');

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000fb0f1');
set local role authenticated;

select is(public.publish_form_template('00000000-0000-0000-0000-00000000e001'), 2, 'republishing makes version 2');

select is(
  (select array_agg(jsonb_array_length(fields) order by version) from public.form_template_versions
    where template_id = '00000000-0000-0000-0000-00000000e001'),
  array[1, 2],
  'version 1 keeps its fields; version 2 has the new one'
);

select is(
  (select template_version from public.form_submissions where id = '00000000-0000-0000-0000-0000000fb5a1'),
  1,
  'an existing submission keeps the version it was started on'
);

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.form_inbox(p_template_id => '00000000-0000-0000-0000-00000000e002', p_status => 'not_started')
    where officer_id in ('00000000-0000-0000-0000-0000000fb0a1', '00000000-0000-0000-0000-0000000fb0b1',
                         '00000000-0000-0000-0000-0000000fb0c1')),
  3,
  'admin inbox lists officers who have not started a role-assigned form'
);

select results_eq(
  $$ select status, overdue from public.form_inbox(p_template_id => '00000000-0000-0000-0000-00000000e001', p_overdue => true) $$,
  $$ values ('draft'::text, true) $$,
  'a draft past its due date is overdue'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000fb0e1');
set local role authenticated;

select results_eq(
  $$ select officer_id from public.form_inbox(p_template_id => '00000000-0000-0000-0000-00000000e002', p_status => 'not_started') $$,
  $$ values ('00000000-0000-0000-0000-0000000fb0a1'::uuid) $$,
  'a supervisor sees not-started rows only for officers at their sites'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000fb0a1');
set local role authenticated;

select is_empty(
  $$ select 1 from public.form_inbox() $$,
  'officers get nothing from the inbox'
);

-- ---------------------------------------------------------------------------
-- Review notifies the officer
-- ---------------------------------------------------------------------------

set local role postgres;
update public.form_submissions
   set status = 'submitted', submitted_at = now(), signed_at = now(),
       filled_pdf_path = '00000000-0000-0000-0000-0000000fb0a1/00000000-0000-0000-0000-0000000fb5a1/filled-1.pdf',
       filled_pdf_sha256 = repeat('ab', 32)
 where id = '00000000-0000-0000-0000-0000000fb5a1';

select pg_temp.login_as('00000000-0000-0000-0000-0000000fb0e1');
set local role authenticated;
select public.review_form_submission('00000000-0000-0000-0000-0000000fb5a1', 'returned', 'Add the gate number');
set local role postgres;

select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000fb0a1' and type = 'form_returned'),
  'Add the gate number',
  'returning a form notifies the officer with the notes'
);

select * from finish();
rollback;
