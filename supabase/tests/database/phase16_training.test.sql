-- Phase 16 tests: training (lessons, assessments, progress, graded attempts).
-- Run with: pnpm db:test
--
-- Officers A (site 1), B (site 2), C (no site); supervisor S (site 1); admin D.
-- L1 ...d001: 2 pages, assessment X1 (3 questions, max 2 attempts, pass 70 %,
--             answers shown after the final attempt), assigned to A.
-- L2 ...d002: assigned to B only.
-- L3 ...d003: 1 page, assessment X3 (1 question, 10 min limit), assigned to
--             the officer role; a pass creates "Fire safety" valid 12 months.
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

select plan(36);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000016a0a1', 'p16.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16 Officer A"}'),
  ('00000000-0000-0000-0000-00000016a0b1', 'p16.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16 Officer B"}'),
  ('00000000-0000-0000-0000-00000016a0c1', 'p16.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16 Officer C"}'),
  ('00000000-0000-0000-0000-00000016a0e1', 'p16.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P16 Supervisor"}'),
  ('00000000-0000-0000-0000-00000016a0f1', 'p16.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P16 Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000016c000', 'P16 Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-00000016c051', '00000000-0000-0000-0000-00000016c000', 'P16 Site 1'),
  ('00000000-0000-0000-0000-00000016c052', '00000000-0000-0000-0000-00000016c000', 'P16 Site 2');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-00000016c051', '00000000-0000-0000-0000-00000016a0a1'),
  ('00000000-0000-0000-0000-00000016c051', '00000000-0000-0000-0000-00000016a0e1'),
  ('00000000-0000-0000-0000-00000016c052', '00000000-0000-0000-0000-00000016a0b1');

insert into public.lessons (id, title, pdf_path, page_count, page_image_paths) values
  ('00000000-0000-0000-0000-00000016d001', 'P16 Patrol basics', '00000000-0000-0000-0000-00000016d001/u1/original.pdf', 2,
   array['00000000-0000-0000-0000-00000016d001/u1/page-1.png', '00000000-0000-0000-0000-00000016d001/u1/page-2.png']),
  ('00000000-0000-0000-0000-00000016d002', 'P16 Other', '00000000-0000-0000-0000-00000016d002/u1/original.pdf', 1,
   array['00000000-0000-0000-0000-00000016d002/u1/page-1.png']),
  ('00000000-0000-0000-0000-00000016d003', 'P16 Fire safety', '00000000-0000-0000-0000-00000016d003/u1/original.pdf', 1,
   array['00000000-0000-0000-0000-00000016d003/u1/page-1.png']);

insert into public.assessments (id, lesson_id, max_attempts, time_limit_minutes, show_correct_answers_after) values
  ('00000000-0000-0000-0000-00000016e001', '00000000-0000-0000-0000-00000016d001', 2, null, 'after_final_attempt'),
  ('00000000-0000-0000-0000-00000016e002', '00000000-0000-0000-0000-00000016d002', null, null, 'never'),
  ('00000000-0000-0000-0000-00000016e003', '00000000-0000-0000-0000-00000016d003', null, 10, 'after_pass');

insert into public.questions (id, assessment_id, type, prompt, explanation, sort_order) values
  ('00000000-0000-0000-0000-00000016f011', '00000000-0000-0000-0000-00000016e001', 'single_choice', 'Who do you call first?', 'Always the supervisor.', 1),
  ('00000000-0000-0000-0000-00000016f012', '00000000-0000-0000-0000-00000016e001', 'multiple_choice', 'Which belong in the log?', 'Times and names.', 2),
  ('00000000-0000-0000-0000-00000016f013', '00000000-0000-0000-0000-00000016e001', 'true_false', 'Patrols are optional.', 'They are not.', 3),
  ('00000000-0000-0000-0000-00000016f021', '00000000-0000-0000-0000-00000016e002', 'single_choice', 'Other?', null, 1),
  ('00000000-0000-0000-0000-00000016f031', '00000000-0000-0000-0000-00000016e003', 'single_choice', 'Extinguisher for electrical fires?', 'CO2.', 1);

insert into public.question_options (id, question_id, text, is_correct, sort_order) values
  ('00000000-0000-0000-0000-000000161111', '00000000-0000-0000-0000-00000016f011', 'Supervisor', true, 1),
  ('00000000-0000-0000-0000-000000161112', '00000000-0000-0000-0000-00000016f011', 'Client', false, 2),
  ('00000000-0000-0000-0000-000000161121', '00000000-0000-0000-0000-00000016f012', 'Times', true, 1),
  ('00000000-0000-0000-0000-000000161122', '00000000-0000-0000-0000-00000016f012', 'Names', true, 2),
  ('00000000-0000-0000-0000-000000161123', '00000000-0000-0000-0000-00000016f012', 'Jokes', false, 3),
  ('00000000-0000-0000-0000-000000161131', '00000000-0000-0000-0000-00000016f013', 'True', false, 1),
  ('00000000-0000-0000-0000-000000161132', '00000000-0000-0000-0000-00000016f013', 'False', true, 2),
  ('00000000-0000-0000-0000-000000162111', '00000000-0000-0000-0000-00000016f021', 'Yes', true, 1),
  ('00000000-0000-0000-0000-000000162112', '00000000-0000-0000-0000-00000016f021', 'No', false, 2),
  ('00000000-0000-0000-0000-000000163111', '00000000-0000-0000-0000-00000016f031', 'CO2', true, 1),
  ('00000000-0000-0000-0000-000000163112', '00000000-0000-0000-0000-00000016f031', 'Water', false, 2);

update public.lessons set status = 'published'
 where id in ('00000000-0000-0000-0000-00000016d001', '00000000-0000-0000-0000-00000016d002',
              '00000000-0000-0000-0000-00000016d003');

insert into public.lesson_assignments (lesson_id, officer_id, site_id, role, creates_qualification_type, qualification_valid_months) values
  ('00000000-0000-0000-0000-00000016d001', '00000000-0000-0000-0000-00000016a0a1', null, null, null, null),
  ('00000000-0000-0000-0000-00000016d002', '00000000-0000-0000-0000-00000016a0b1', null, null, null, null),
  ('00000000-0000-0000-0000-00000016d003', null, null, 'officer', 'Fire safety', 12);

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
-- Schema and publishing (as postgres)
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.lessons'::regclass, 'public.assessments'::regclass,
                  'public.questions'::regclass, 'public.question_options'::regclass,
                  'public.lesson_assignments'::regclass, 'public.lesson_progress'::regclass,
                  'public.assessment_attempts'::regclass)),
  'RLS is enabled on every training table'
);

select ok(
  not has_function_privilege('authenticated', 'public.assessment_gate(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.attempt_review(public.assessment_attempts)', 'execute'),
  'internal grading helpers are not callable through the API'
);

insert into public.lessons (id, title, pdf_path, page_count, page_image_paths) values
  ('00000000-0000-0000-0000-00000016d009', 'P16 Broken', '00000000-0000-0000-0000-00000016d009/u1/original.pdf', 1,
   array['00000000-0000-0000-0000-00000016d009/u1/page-1.png']);
insert into public.assessments (id, lesson_id) values
  ('00000000-0000-0000-0000-00000016e009', '00000000-0000-0000-0000-00000016d009');
insert into public.questions (id, assessment_id, type, prompt) values
  ('00000000-0000-0000-0000-00000016f091', '00000000-0000-0000-0000-00000016e009', 'single_choice', 'No right answer');
insert into public.question_options (question_id, text, is_correct) values
  ('00000000-0000-0000-0000-00000016f091', 'A', false),
  ('00000000-0000-0000-0000-00000016f091', 'B', false);

select throws_ok(
  $$ update public.lessons set status = 'published' where id = '00000000-0000-0000-0000-00000016d009' $$,
  'P0001',
  null,
  'a lesson whose question has no correct answer cannot be published'
);

-- ---------------------------------------------------------------------------
-- Officer A: no answer key, reading first
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-00000016a0a1');
set local role authenticated;

select is(
  (select count(*)::int from public.question_options),
  0,
  'an officer cannot read question_options (so never is_correct)'
);

select is(
  (select count(*)::int from public.questions),
  0,
  'an officer cannot read questions directly (explanations give answers away)'
);

select is_empty(
  $$ select 1 from public.lessons where id = '00000000-0000-0000-0000-00000016d002' $$,
  'an officer cannot read a lesson not assigned to them'
);

select throws_ok(
  $$ select public.record_lesson_progress('00000000-0000-0000-0000-00000016d002', array[1], 30) $$,
  '42501',
  null,
  'an officer cannot record progress on a lesson not assigned to them'
);

select throws_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000016e001') $$,
  'DG010',
  'Finish reading the lesson before starting the quiz',
  'an officer cannot open the quiz before finishing reading'
);

select throws_ok(
  $$ select public.submit_attempt('00000000-0000-0000-0000-00000016e001', '{}'::jsonb) $$,
  'DG010',
  null,
  'an officer cannot submit answers before finishing reading'
);

select is_empty(
  $$ with u as (update public.lesson_progress set completed_reading_at = now() returning 1) select * from u $$,
  'an officer cannot mark reading complete by writing the table'
);

select throws_ok(
  $$ insert into public.lesson_progress (lesson_id, officer_id, completed_reading_at)
     values ('00000000-0000-0000-0000-00000016d001', '00000000-0000-0000-0000-00000016a0a1', now()) $$,
  '42501',
  null,
  'an officer cannot insert progress directly'
);

select throws_ok(
  $$ select public.record_lesson_progress('00000000-0000-0000-0000-00000016d001', array[3], 10) $$,
  '22023',
  null,
  'a page the lesson does not have is refused'
);

select is(
  (public.record_lesson_progress('00000000-0000-0000-0000-00000016d001', array[1], 60)).completed_reading_at,
  null,
  'one page of two read: reading not complete'
);

select isnt(
  (public.record_lesson_progress('00000000-0000-0000-0000-00000016d001', array[2], 9999)).completed_reading_at,
  null,
  'every page read: reading complete'
);

select is(
  (select seconds_spent from public.lesson_progress
    where lesson_id = '00000000-0000-0000-0000-00000016d001'),
  60 + 3600,
  'time per call is capped at an hour'
);

-- ---------------------------------------------------------------------------
-- The quiz, attempts and the attempt limit
-- ---------------------------------------------------------------------------

select ok(
  (select public.get_assessment_for_officer('00000000-0000-0000-0000-00000016e001')::text
     not like '%is_correct%'
   and public.get_assessment_for_officer('00000000-0000-0000-0000-00000016e001')::text
     not like '%explanation%'),
  'the quiz an officer gets has no is_correct and no explanations'
);

select is(
  jsonb_array_length(public.get_assessment_for_officer('00000000-0000-0000-0000-00000016e001') -> 'questions'),
  3,
  'the quiz has all three questions'
);

select is(
  (select count(*)::int from public.assessment_attempts
    where assessment_id = '00000000-0000-0000-0000-00000016e001'),
  1,
  'opening the quiz again resumes the same attempt'
);

select throws_ok(
  $$ insert into public.assessment_attempts (assessment_id, officer_id, attempt_number, submitted_at, score_percent, passed)
     values ('00000000-0000-0000-0000-00000016e001', '00000000-0000-0000-0000-00000016a0a1', 9, now(), 100, true) $$,
  '42501',
  null,
  'an officer cannot write an attempt directly'
);

select throws_ok(
  $$ select public.submit_attempt('00000000-0000-0000-0000-00000016e001',
       '{"00000000-0000-0000-0000-00000016f011": ["00000000-0000-0000-0000-000000163111"]}'::jsonb) $$,
  '22023',
  null,
  'an option from another question is refused'
);

-- Attempt 1: one right (Q11), Q12 half right (no points), Q13 missing = 1/3.
select results_eq(
  $$ select (r ->> 'score_percent')::numeric, (r ->> 'passed')::boolean, (r ->> 'attempts_left')::int, jsonb_typeof(r -> 'review')
       from (select public.submit_attempt('00000000-0000-0000-0000-00000016e001',
         '{"00000000-0000-0000-0000-00000016f011": ["00000000-0000-0000-0000-000000161111"],
           "00000000-0000-0000-0000-00000016f012": ["00000000-0000-0000-0000-000000161121"]}'::jsonb) r) x $$,
  $$ values (33.33::numeric, false, 1, 'null'::text) $$,
  'attempt 1 is graded on the server (33.33 %, failed, 1 left, no answers shown yet)'
);

-- Attempt 2 (started by submitting): wrong again; the final attempt shows answers.
select ok(
  (select (r ->> 'passed')::boolean = false and (r ->> 'attempts_left')::int = 0
          and jsonb_typeof(r -> 'review') = 'array' and jsonb_array_length(r -> 'review') = 3
     from (select public.submit_attempt('00000000-0000-0000-0000-00000016e001',
       '{"00000000-0000-0000-0000-00000016f011": ["00000000-0000-0000-0000-000000161112"]}'::jsonb) r) x),
  'attempt 2 fails; after the final attempt the correct answers are shown'
);

select throws_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000016e001') $$,
  'DG011',
  null,
  'an officer cannot open a third attempt when max_attempts is 2'
);

select throws_ok(
  $$ select public.submit_attempt('00000000-0000-0000-0000-00000016e001', '{}'::jsonb) $$,
  'DG011',
  null,
  'an officer cannot submit a third attempt when max_attempts is 2'
);

-- ---------------------------------------------------------------------------
-- Passing creates the qualification; passing ends the assessment
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.record_lesson_progress('00000000-0000-0000-0000-00000016d003', array[1], 120) $$,
  'officer A reads the role-assigned lesson'
);

select is(
  (public.submit_attempt('00000000-0000-0000-0000-00000016e003',
     '{"00000000-0000-0000-0000-00000016f031": ["00000000-0000-0000-0000-000000163111"]}'::jsonb) ->> 'passed')::boolean,
  true,
  'all correct: passed'
);

select is(
  (select expires_on from public.qualifications
    where user_id = '00000000-0000-0000-0000-00000016a0a1' and type = 'Fire safety'),
  ((select (now() at time zone coalesce((select time_zone from public.settings where id), 'UTC'))::date)
    + interval '12 months')::date,
  'a pass creates the assignment''s qualification, valid 12 months'
);

select throws_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000016e003') $$,
  'DG012',
  null,
  'after a pass the quiz cannot be taken again'
);

-- ---------------------------------------------------------------------------
-- Time limit (officer C)
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016a0c1');
set local role authenticated;

select public.record_lesson_progress('00000000-0000-0000-0000-00000016d003', array[1], 30);
select public.get_assessment_for_officer('00000000-0000-0000-0000-00000016e003');

set local role postgres;
update public.assessment_attempts set started_at = now() - interval '1 hour'
 where officer_id = '00000000-0000-0000-0000-00000016a0c1';
set local role authenticated;

select results_eq(
  $$ select (r ->> 'timed_out')::boolean, (r ->> 'score_percent')::numeric, (r ->> 'passed')::boolean
       from (select public.submit_attempt('00000000-0000-0000-0000-00000016e003',
         '{"00000000-0000-0000-0000-00000016f031": ["00000000-0000-0000-0000-000000163111"]}'::jsonb) r) x $$,
  $$ values (true, 0::numeric, false) $$,
  'answers submitted after the time limit score 0'
);

select is(
  (select count(*)::int from public.qualifications where user_id = '00000000-0000-0000-0000-00000016a0c1'),
  0,
  '...and create no qualification'
);

select is_empty(
  $$ select 1 from public.assessment_attempts where officer_id = '00000000-0000-0000-0000-00000016a0a1' $$,
  'an officer cannot read another officer''s attempts'
);

select is_empty(
  $$ select 1 from public.lesson_progress where officer_id = '00000000-0000-0000-0000-00000016a0a1' $$,
  'an officer cannot read another officer''s progress'
);

-- ---------------------------------------------------------------------------
-- Supervisors and admins
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016a0e1');
set local role authenticated;

select is(
  (select count(*)::int from public.assessment_attempts
    where officer_id in ('00000000-0000-0000-0000-00000016a0a1', '00000000-0000-0000-0000-00000016a0c1')),
  3,
  'a supervisor reads attempts of officers at their site (A: 3) and not others (C)'
);

select is(
  (select count(*)::int from public.lesson_progress
    where officer_id in ('00000000-0000-0000-0000-00000016a0a1', '00000000-0000-0000-0000-00000016a0c1')),
  2,
  'a supervisor reads progress of officers at their site only'
);

select throws_ok(
  $$ insert into public.lessons (title) values ('Supervisor lesson') $$,
  '42501',
  null,
  'supervisors cannot create lessons'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016a0f1');
set local role authenticated;

select is(
  (select count(*)::int from public.question_options
    where question_id = '00000000-0000-0000-0000-00000016f012' and is_correct),
  2,
  'admins read the answer key'
);

select * from finish();
rollback;
