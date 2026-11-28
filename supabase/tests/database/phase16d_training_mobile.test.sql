-- Phase 16d tests: assessment_overview() and the due-soon reminders.
-- Run with: pnpm db:test
--
-- Officers A and B (role assignment), C (no assignment). Lesson L with a
-- 2-question quiz (max 2 attempts, 15 min), assigned to the officer role
-- 5 days ago, due in 1 day.
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

select plan(11);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000016d0a1', 'p16d.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16d A"}'),
  ('00000000-0000-0000-0000-00000016d0b1', 'p16d.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16d B"}'),
  ('00000000-0000-0000-0000-00000016d0e1', 'p16d.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P16d Sup"}');

insert into public.lessons (id, title, pdf_path, page_count, page_image_paths) values
  ('00000000-0000-0000-0000-00000016dd01', 'P16d Lesson', '00000000-0000-0000-0000-00000016dd01/u1/original.pdf', 1,
   array['00000000-0000-0000-0000-00000016dd01/u1/page-1.png']);
insert into public.assessments (id, lesson_id, max_attempts, time_limit_minutes) values
  ('00000000-0000-0000-0000-00000016de01', '00000000-0000-0000-0000-00000016dd01', 2, 15);
insert into public.questions (id, assessment_id, type, prompt, points) values
  ('00000000-0000-0000-0000-00000016df01', '00000000-0000-0000-0000-00000016de01', 'single_choice', 'Q1', 1),
  ('00000000-0000-0000-0000-00000016df02', '00000000-0000-0000-0000-00000016de01', 'true_false', 'Q2', 3);
insert into public.question_options (id, question_id, text, is_correct) values
  ('00000000-0000-0000-0000-0000016d0011', '00000000-0000-0000-0000-00000016df01', 'Yes', true),
  ('00000000-0000-0000-0000-0000016d0012', '00000000-0000-0000-0000-00000016df01', 'No', false),
  ('00000000-0000-0000-0000-0000016d0021', '00000000-0000-0000-0000-00000016df02', 'True', true),
  ('00000000-0000-0000-0000-0000016d0022', '00000000-0000-0000-0000-00000016df02', 'False', false);
update public.lessons set status = 'published' where id = '00000000-0000-0000-0000-00000016dd01';

insert into public.lesson_assignments (id, lesson_id, role, due_at) values
  ('00000000-0000-0000-0000-00000016da01', '00000000-0000-0000-0000-00000016dd01', 'officer', now() + interval '1 day');
-- Made 5 days ago (triggers keep created_at, so bypass them for this fixture).
set local session_replication_role = replica;
update public.lesson_assignments set created_at = now() - interval '5 days'
 where id = '00000000-0000-0000-0000-00000016da01';
set local session_replication_role = origin;
-- Ignore the "new training" alerts from the insert.
delete from public.notifications where type = 'lesson_assigned';

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
-- assessment_overview
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-00000016d0a1');
set local role authenticated;

select results_eq(
  $$ select (o ->> 'question_count')::int, (o ->> 'total_points')::int, (o ->> 'attempts_left')::int,
            (o ->> 'time_limit_minutes')::int, (o ->> 'reading_complete')::boolean, o -> 'open_attempt'
       from (select public.assessment_overview('00000000-0000-0000-0000-00000016de01') o) x $$,
  $$ values (2, 4, 2, 15, false, 'null'::jsonb) $$,
  'the overview gives the rules without the questions'
);

select ok(
  public.assessment_overview('00000000-0000-0000-0000-00000016de01')::text not like '%Q1%',
  'the overview reveals no question text'
);

select is(
  (select count(*)::int from public.assessment_attempts),
  0,
  'reading the overview does not start an attempt (the clock)'
);

select public.record_lesson_progress('00000000-0000-0000-0000-00000016dd01', array[1], 60);
select public.get_assessment_for_officer('00000000-0000-0000-0000-00000016de01');

select ok(
  (select (o -> 'open_attempt' ->> 'expires_at') is not null and (o ->> 'reading_complete')::boolean
     from (select public.assessment_overview('00000000-0000-0000-0000-00000016de01') o) x),
  'after opening the quiz the overview shows the open attempt and when it expires'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016d0e1');
set local role authenticated;

select throws_ok(
  $$ select public.assessment_overview('00000000-0000-0000-0000-00000016de01') $$,
  '42501',
  null,
  'someone the lesson is not assigned to gets nothing'
);

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------

set local role postgres;

-- Officer B already passed.
insert into public.assessment_attempts (assessment_id, officer_id, attempt_number, submitted_at, score_percent, passed)
values ('00000000-0000-0000-0000-00000016de01', '00000000-0000-0000-0000-00000016d0b1', 1, now(), 100, true);

select cmp_ok(public.notify_lessons_due_soon(), '>=', 1, 'the hourly job creates reminders');

select is(
  (select count(*)::int from public.notifications
    where type = 'lesson_due_soon' and user_id = '00000000-0000-0000-0000-00000016d0a1'),
  1,
  'officer A (not passed) is reminded'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'lesson_due_soon' and user_id = '00000000-0000-0000-0000-00000016d0b1'),
  0,
  'officer B (passed) is not reminded'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'lesson_due_soon' and data ->> 'assignment_id' = '00000000-0000-0000-0000-00000016da01'
      and user_id = '00000000-0000-0000-0000-00000016d0a1'
      and title = 'Training due soon: P16d Lesson'),
  1,
  'the reminder names the lesson'
);

select public.notify_lessons_due_soon();
select is(
  (select count(*)::int from public.notifications
    where type = 'lesson_due_soon' and user_id = '00000000-0000-0000-0000-00000016d0a1'),
  1,
  'running the job again does not remind twice'
);

-- A lesson assigned only a day before it is due gets no extra reminder.
insert into public.lesson_assignments (id, lesson_id, officer_id, due_at) values
  ('00000000-0000-0000-0000-00000016da02', '00000000-0000-0000-0000-00000016dd01',
   '00000000-0000-0000-0000-00000016d0a1', now() + interval '1 day');
select public.notify_lessons_due_soon();
select is(
  (select count(*)::int from public.notifications
    where type = 'lesson_due_soon' and data ->> 'assignment_id' = '00000000-0000-0000-0000-00000016da02'),
  0,
  'an assignment made less than 2 days before it is due gets no reminder'
);

select * from finish();
rollback;
