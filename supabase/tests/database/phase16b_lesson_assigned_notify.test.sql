-- Phase 16b tests: a new lesson assignment notifies everyone it reaches.
-- Run with: pnpm db:test
--
-- Officers A (site 1), B (site 2); supervisor S (site 1); suspended officer X (site 1).
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

select plan(6);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000016b0a1', 'p16b.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16b Officer A"}'),
  ('00000000-0000-0000-0000-00000016b0b1', 'p16b.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16b Officer B"}'),
  ('00000000-0000-0000-0000-00000016b0e1', 'p16b.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P16b Supervisor"}'),
  ('00000000-0000-0000-0000-00000016b0d1', 'p16b.x@test.local', '{"role":"officer","employment_status":"suspended"}', '{"full_name":"P16b Suspended"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000016bc00', 'P16b Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-00000016bc51', '00000000-0000-0000-0000-00000016bc00', 'P16b Site 1'),
  ('00000000-0000-0000-0000-00000016bc52', '00000000-0000-0000-0000-00000016bc00', 'P16b Site 2');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000016bc51', '00000000-0000-0000-0000-00000016b0a1'),
  ('00000000-0000-0000-0000-00000016bc51', '00000000-0000-0000-0000-00000016b0e1'),
  ('00000000-0000-0000-0000-00000016bc51', '00000000-0000-0000-0000-00000016b0d1'),
  ('00000000-0000-0000-0000-00000016bc52', '00000000-0000-0000-0000-00000016b0b1');

insert into public.lessons (id, title, pdf_path, page_count, page_image_paths, estimated_minutes) values
  ('00000000-0000-0000-0000-00000016bd01', 'P16b Radio use', '00000000-0000-0000-0000-00000016bd01/u1/original.pdf', 1,
   array['00000000-0000-0000-0000-00000016bd01/u1/page-1.png'], 15);
update public.lessons set status = 'published' where id = '00000000-0000-0000-0000-00000016bd01';

-- To one officer, with a due date and a qualification.
insert into public.lesson_assignments (id, lesson_id, officer_id, due_at, creates_qualification_type) values
  ('00000000-0000-0000-0000-00000016bf01', '00000000-0000-0000-0000-00000016bd01',
   '00000000-0000-0000-0000-00000016b0a1', '2031-03-10 18:00:00+00', 'Radio');
-- To everyone at site 1.
insert into public.lesson_assignments (id, lesson_id, site_id) values
  ('00000000-0000-0000-0000-00000016bf02', '00000000-0000-0000-0000-00000016bd01',
   '00000000-0000-0000-0000-00000016bc51');

select is(
  (select count(*)::int from public.notifications
    where type = 'lesson_assigned' and data ->> 'assignment_id' = '00000000-0000-0000-0000-00000016bf01'),
  1,
  'a direct assignment notifies that officer only'
);

select ok(
  (select title = 'New training: P16b Radio use'
          and body like 'Due %'
          and body like '%About 15 min.%'
          and body like '%Radio qualification.%'
     from public.notifications
    where data ->> 'assignment_id' = '00000000-0000-0000-0000-00000016bf01'),
  'the alert names the lesson, due date, length and qualification'
);

select results_eq(
  $$ select user_id from public.notifications
      where type = 'lesson_assigned' and data ->> 'assignment_id' = '00000000-0000-0000-0000-00000016bf02'
      order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000016b0a1'::uuid), ('00000000-0000-0000-0000-00000016b0e1'::uuid) $$,
  'a site assignment notifies active people at that site (not the suspended officer, not other sites)'
);

select is(
  (select data ->> 'lesson_id' from public.notifications
    where data ->> 'assignment_id' = '00000000-0000-0000-0000-00000016bf02' limit 1),
  '00000000-0000-0000-0000-00000016bd01',
  'the alert carries the lesson id for the app to open'
);

-- A role assignment reaches every active officer.
insert into public.lesson_assignments (id, lesson_id, role) values
  ('00000000-0000-0000-0000-00000016bf03', '00000000-0000-0000-0000-00000016bd01', 'officer');

select ok(
  (select count(*) = 2 from public.notifications
    where data ->> 'assignment_id' = '00000000-0000-0000-0000-00000016bf03'
      and user_id in ('00000000-0000-0000-0000-00000016b0a1', '00000000-0000-0000-0000-00000016b0b1',
                      '00000000-0000-0000-0000-00000016b0d1', '00000000-0000-0000-0000-00000016b0e1')),
  'a role assignment notifies every active officer (A and B), not the suspended one or supervisors'
);

select ok(
  not has_function_privilege('authenticated', 'public.notify_lesson_assigned()', 'execute'),
  'the trigger function cannot be called through the API'
);

select * from finish();
rollback;
