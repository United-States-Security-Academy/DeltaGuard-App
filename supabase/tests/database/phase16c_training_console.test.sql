-- Phase 16c tests: extra attempts, the question builder, results and stats.
-- Run with: pnpm db:test
--
-- Officers A, B, C (all at site 1); supervisor S (site 1); admin D.
-- Lesson L (1 page) with assessment X (max 1 attempt): Q1 single choice, Q2
-- multiple choice. Assigned to the officer role, due in the past.
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

select plan(20);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000016c0a1', 'p16c.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16c A"}'),
  ('00000000-0000-0000-0000-00000016c0b1', 'p16c.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16c B"}'),
  ('00000000-0000-0000-0000-00000016c0c1', 'p16c.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P16c C"}'),
  ('00000000-0000-0000-0000-00000016c0e1', 'p16c.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P16c Supervisor"}'),
  ('00000000-0000-0000-0000-00000016c0f1', 'p16c.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P16c Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-00000016cc00', 'P16c Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-00000016cc51', '00000000-0000-0000-0000-00000016cc00', 'P16c Site');
insert into public.site_assignments (site_id, officer_id)
select '00000000-0000-0000-0000-00000016cc51', u
  from unnest(array['00000000-0000-0000-0000-00000016c0a1', '00000000-0000-0000-0000-00000016c0b1',
                    '00000000-0000-0000-0000-00000016c0c1', '00000000-0000-0000-0000-00000016c0e1']::uuid[]) u;

insert into public.lessons (id, title, pdf_path, page_count, page_image_paths) values
  ('00000000-0000-0000-0000-00000016cd01', 'P16c Lesson', '00000000-0000-0000-0000-00000016cd01/u1/original.pdf', 1,
   array['00000000-0000-0000-0000-00000016cd01/u1/page-1.png']);
insert into public.assessments (id, lesson_id, max_attempts) values
  ('00000000-0000-0000-0000-00000016ce01', '00000000-0000-0000-0000-00000016cd01', 1);

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
-- Question builder (admin)
-- ---------------------------------------------------------------------------

select pg_temp.login_as('00000000-0000-0000-0000-00000016c0f1');
set local role authenticated;

select throws_ok(
  $$ select public.save_questions('00000000-0000-0000-0000-00000016ce01',
       '[{"type":"single_choice","prompt":"Two right?","options":[{"text":"A","is_correct":true},{"text":"B","is_correct":true}]}]'::jsonb) $$,
  '22023',
  null,
  'a single-choice question with two correct answers is refused'
);

select is(
  cardinality(public.save_questions('00000000-0000-0000-0000-00000016ce01',
    '[{"id":"00000000-0000-0000-0000-00000016cf01","type":"single_choice","prompt":"Q1","options":[
        {"id":"00000000-0000-0000-0000-0000016c0101","text":"Right","is_correct":true},
        {"id":"00000000-0000-0000-0000-0000016c0102","text":"Wrong","is_correct":false}]},
      {"type":"multiple_choice","prompt":"Q2","points":2,"options":[
        {"text":"A","is_correct":true},{"text":"B","is_correct":true},{"text":"C","is_correct":false}]}]'::jsonb)),
  2,
  'save_questions adds two questions'
);

select set_config('p16c.q1', (select id::text from public.questions where prompt = 'Q1'), true);
select set_config('p16c.q2', (select id::text from public.questions where prompt = 'Q2'), true);
select set_config('p16c.o1', (select id::text from public.question_options
                                where question_id = current_setting('p16c.q1')::uuid and is_correct), true);

select lives_ok(
  format($$ select public.save_questions('00000000-0000-0000-0000-00000016ce01',
    '[{"id":"%s","type":"single_choice","prompt":"Q1 edited","explanation":"Because.","options":[
       {"id":"%s","text":"Right (edited)","is_correct":true},
       {"text":"New wrong","is_correct":false}]}]'::jsonb) $$,
    current_setting('p16c.q1'), current_setting('p16c.o1')),
  'editing a question with its option ids'
);

select ok(
  (select q.prompt = 'Q1 edited' and q.explanation = 'Because.'
     from public.questions q where q.id = current_setting('p16c.q1')::uuid)
  and exists (select 1 from public.question_options
               where id = current_setting('p16c.o1')::uuid and text = 'Right (edited)')
  and (select count(*) from public.question_options
        where question_id = current_setting('p16c.q1')::uuid) = 2,
  '...keeps the question and option ids, adds the new option and deletes the one left out'
);

select lives_ok(
  format($$ select public.reorder_questions('00000000-0000-0000-0000-00000016ce01', array['%s', '%s']::uuid[]) $$,
    current_setting('p16c.q2'), current_setting('p16c.q1')),
  'reorder_questions runs'
);

select is(
  (select array_agg(prompt order by sort_order) from public.questions
    where assessment_id = '00000000-0000-0000-0000-00000016ce01'),
  array['Q2', 'Q1 edited'],
  '...and sets the new order'
);

-- Publish and assign (role: officer, due yesterday).
update public.lessons set status = 'published' where id = '00000000-0000-0000-0000-00000016cd01';
insert into public.lesson_assignments (lesson_id, role, due_at) values
  ('00000000-0000-0000-0000-00000016cd01', 'officer', now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- Officers: A reads and fails, C starts reading, B nothing
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0a1');
set local role authenticated;
select public.record_lesson_progress('00000000-0000-0000-0000-00000016cd01', array[1], 300);
select public.submit_attempt('00000000-0000-0000-0000-00000016ce01',
  jsonb_build_object(current_setting('p16c.q1'), jsonb_build_array(current_setting('p16c.o1'))));

select throws_ok(
  $$ select public.get_assessment_for_officer('00000000-0000-0000-0000-00000016ce01') $$,
  'DG011',
  null,
  'with max 1 attempt used, the officer is out of attempts'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0c1');
set local role authenticated;
select public.record_lesson_progress('00000000-0000-0000-0000-00000016cd01', '{}', 20);

-- ---------------------------------------------------------------------------
-- Results and stats (admin)
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0f1');
set local role authenticated;

select results_eq(
  $$ select officer_name, status, overdue, attempts, best_score from public.lesson_results('00000000-0000-0000-0000-00000016cd01')
      where officer_name like 'P16c%' order by officer_name $$,
  $$ values ('P16c A'::text, 'failed'::text, true, 1, 33.33::numeric),
            ('P16c B', 'not_started', true, 0, null),
            ('P16c C', 'reading', true, 0, null) $$,
  'results: A failed (1/3 points), B not started, C reading; all overdue'
);

select results_eq(
  $$ select prompt, attempts, correct, wrong_percent from public.lesson_question_stats('00000000-0000-0000-0000-00000016cd01') $$,
  $$ values ('Q2'::text, 1, 0, 100.0::numeric), ('Q1 edited', 1, 1, 0.0) $$,
  'stats: Q2 (unanswered) is the most often wrong'
);

-- ---------------------------------------------------------------------------
-- Extra attempt
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0e1');
set local role authenticated;

select throws_ok(
  $$ select public.grant_extra_attempt('00000000-0000-0000-0000-00000016ce01', '00000000-0000-0000-0000-00000016c0a1') $$,
  '42501',
  null,
  'a supervisor cannot grant an extra attempt'
);

select is(
  (select count(*)::int from public.lesson_results('00000000-0000-0000-0000-00000016cd01')
    where officer_name like 'P16c%'),
  3,
  'a supervisor sees results for officers at their site'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0a1');
set local role authenticated;

select throws_ok(
  $$ select public.grant_extra_attempt('00000000-0000-0000-0000-00000016ce01', '00000000-0000-0000-0000-00000016c0a1') $$,
  '42501',
  null,
  'an officer cannot grant themselves an attempt'
);

select is_empty(
  $$ select 1 from public.lesson_results('00000000-0000-0000-0000-00000016cd01') $$,
  'officers get no results'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0f1');
set local role authenticated;

select is(
  public.grant_extra_attempt('00000000-0000-0000-0000-00000016ce01', '00000000-0000-0000-0000-00000016c0a1', 'Phone died'),
  2,
  'an admin grants officer A one extra attempt (now 2 allowed)'
);

select is(
  (select status from public.lesson_results('00000000-0000-0000-0000-00000016cd01') where officer_name = 'P16c A'),
  'ready_for_quiz',
  'with the extra attempt A is ready for the quiz again'
);

select is(
  (select attempts_allowed from public.lesson_results('00000000-0000-0000-0000-00000016cd01') where officer_name = 'P16c B'),
  1,
  'the grant is for A only'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0a1');
set local role authenticated;

select is(
  (public.get_assessment_for_officer('00000000-0000-0000-0000-00000016ce01') -> 'attempt' ->> 'attempt_number')::int,
  2,
  'A can open attempt 2'
);

select is(
  (public.submit_attempt('00000000-0000-0000-0000-00000016ce01',
    jsonb_build_object(current_setting('p16c.q1'), jsonb_build_array(current_setting('p16c.o1'))))
    ->> 'attempts_left')::int,
  0,
  'after attempt 2 no attempts are left'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-00000016c0f1');
set local role authenticated;

select lives_ok(
  $$ select public.grant_extra_attempt('00000000-0000-0000-0000-00000016ce01', '00000000-0000-0000-0000-00000016c0a1') $$,
  'a second grant is allowed'
);

select is(
  (select count(*)::int from public.assessment_attempt_grants
    where officer_id = '00000000-0000-0000-0000-00000016c0a1' and granted_by = '00000000-0000-0000-0000-00000016c0f1'),
  2,
  'every grant is logged with who gave it'
);

select * from finish();
rollback;
