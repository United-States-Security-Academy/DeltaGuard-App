-- Phase 16c: what the console's Training section needs.
--
--   assessment_attempt_grants   extra attempts an admin gave one officer.
--                               effective_max_attempts() = max_attempts +
--                               grants; the quiz functions use it.
--   grant_extra_attempt()       admins: one more attempt for an officer
--   save_questions()            admins: add/edit questions with their options
--                               in one transaction, KEEPING ids of questions
--                               and options that still exist, so officers'
--                               earlier answers still point at them
--   reorder_questions()         admins
--   lesson_results()            staff: every officer a lesson reaches, with
--                               status, reading time, best score, attempts
--   lesson_question_stats()     staff: how often each question is answered
--                               wrongly in submitted attempts
-- Supervisors see results only for officers who share a site with them
-- (the functions run as the caller, so RLS applies).

-- ---------------------------------------------------------------------------
-- Extra attempts
-- ---------------------------------------------------------------------------

create table public.assessment_attempt_grants (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  officer_id uuid not null references public.profiles (id) on delete cascade,
  extra_attempts integer not null default 1 check (extra_attempts between 1 and 10),
  reason text check (char_length(reason) <= 500),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now()
);

create index assessment_attempt_grants_idx
  on public.assessment_attempt_grants (assessment_id, officer_id);

alter table public.assessment_attempt_grants enable row level security;
revoke all on public.assessment_attempt_grants from anon, authenticated;
grant select on public.assessment_attempt_grants to authenticated;
grant all on public.assessment_attempt_grants to service_role;

create policy "assessment_attempt_grants: admins read" on public.assessment_attempt_grants
  for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
create policy "assessment_attempt_grants: supervisors read for their sites"
  on public.assessment_attempt_grants for select to authenticated
  using (public.supervises_officer(officer_id));
create policy "assessment_attempt_grants: officers read their own"
  on public.assessment_attempt_grants for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

/** Attempts allowed for this officer: max_attempts plus granted extras (null = unlimited). */
create function public.effective_max_attempts(p_assessment public.assessments, p_officer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_assessment.max_attempts is null then null
              else p_assessment.max_attempts + coalesce((
                select sum(g.extra_attempts)::integer from public.assessment_attempt_grants g
                 where g.assessment_id = p_assessment.id and g.officer_id = p_officer), 0)
         end
$$;

/** Admins: give one officer one more attempt (written to the grants log). */
create function public.grant_extra_attempt(
  p_assessment_id uuid,
  p_officer_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessments;
begin
  if not public.is_active_user() or public.auth_role() is distinct from 'admin' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v from public.assessments where id = p_assessment_id;
  if not found then
    raise exception 'Assessment not found' using errcode = '42501';
  end if;
  if v.max_attempts is null then
    raise exception 'This assessment has no attempt limit' using errcode = 'P0001';
  end if;
  if not public.lesson_assigned_to(v.lesson_id, p_officer_id) then
    raise exception 'This lesson is not assigned to that officer' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.assessment_attempts
              where assessment_id = v.id and officer_id = p_officer_id and passed) then
    raise exception 'This officer has already passed' using errcode = 'P0001';
  end if;
  if char_length(p_reason) > 500 then
    raise exception 'The reason is too long (500 characters at most)' using errcode = '22023';
  end if;
  insert into public.assessment_attempt_grants (assessment_id, officer_id, reason, granted_by)
  values (v.id, p_officer_id, nullif(btrim(p_reason), ''), auth.uid());
  return public.effective_max_attempts(v, p_officer_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- The quiz functions, now counting granted attempts
-- ---------------------------------------------------------------------------

create or replace function public.get_assessment_for_officer(p_assessment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessments;
  v_max integer;
  v_attempt public.assessment_attempts;
  v_used integer;
begin
  v := public.assessment_gate(p_assessment_id);
  -- Allowed attempts, including extra ones an admin granted (phase 16c).
  v_max := public.effective_max_attempts(v, auth.uid());
  -- One officer, one assessment at a time (no double attempts from two taps).
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || v.id::text, 0));
  perform public.expire_open_attempt(v, auth.uid());

  if exists (select 1 from public.assessment_attempts
              where assessment_id = v.id and officer_id = auth.uid() and passed) then
    raise exception 'You already passed this assessment' using errcode = 'DG012';
  end if;

  select * into v_attempt from public.assessment_attempts
   where assessment_id = v.id and officer_id = auth.uid() and submitted_at is null;
  if not found then
    select count(*) into v_used from public.assessment_attempts
     where assessment_id = v.id and officer_id = auth.uid();
    if v_max is not null and v_used >= v_max then
      raise exception 'No attempts left (% of %)', v_used, v_max using errcode = 'DG011';
    end if;
    insert into public.assessment_attempts (assessment_id, officer_id, attempt_number)
    values (v.id, auth.uid(), v_used + 1)
    returning * into v_attempt;
  end if;

  select count(*) into v_used from public.assessment_attempts
   where assessment_id = v.id and officer_id = auth.uid();

  return jsonb_build_object(
    'assessment_id', v.id,
    'lesson_id', v.lesson_id,
    'pass_mark_percent', v.pass_mark_percent,
    'max_attempts', v_max,
    'time_limit_minutes', v.time_limit_minutes,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'attempt_number', v_attempt.attempt_number,
      'started_at', v_attempt.started_at,
      'expires_at', case when v.time_limit_minutes is null then null
                         else v_attempt.started_at + make_interval(mins => v.time_limit_minutes) end,
      'attempts_left', case when v_max is null then null else v_max - v_used end
    ),
    'questions', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', q.id,
                 'type', q.type,
                 'prompt', q.prompt,
                 'points', q.points,
                 'options', (
                   select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text)
                            order by case when v.shuffle_options
                                          then md5(v_attempt.id::text || o.id::text) end,
                                     o.sort_order, o.id), '[]'::jsonb)
                     from public.question_options o
                    where o.question_id = q.id
                 )
               )
               order by case when v.shuffle_questions
                             then md5(v_attempt.id::text || q.id::text) end,
                        q.sort_order, q.id)
        from public.questions q
       where q.assessment_id = v.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_attempt(p_assessment_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessments;
  v_max integer;
  v_attempt public.assessment_attempts;
  v_used integer;
  v_total integer;
  v_earned integer;
  v_score numeric(5, 2);
  v_passed boolean;
  v_timed_out boolean := false;
  v_answers jsonb := coalesce(p_answers, '{}'::jsonb);
  v_zone text;
  v_today date;
  q record;
  v_selected uuid[];
  v_correct uuid[];
begin
  v := public.assessment_gate(p_assessment_id);
  -- Allowed attempts, including extra ones an admin granted (phase 16c).
  v_max := public.effective_max_attempts(v, auth.uid());
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || v.id::text, 0));

  if exists (select 1 from public.assessment_attempts
              where assessment_id = v.id and officer_id = auth.uid() and passed) then
    raise exception 'You already passed this assessment' using errcode = 'DG012';
  end if;

  -- Answers: an object of question id -> list of option ids of that question.
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'Answers must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(v_answers) e
     where jsonb_typeof(e.value) <> 'array'
        or e.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not exists (select 1 from public.questions qq
                        where qq.id = e.key::uuid and qq.assessment_id = v.id)
  ) then
    raise exception 'Answers name a question that is not in this quiz' using errcode = '22023';
  end if;

  select * into v_attempt from public.assessment_attempts
   where assessment_id = v.id and officer_id = auth.uid() and submitted_at is null
   for update;
  if not found then
    select count(*) into v_used from public.assessment_attempts
     where assessment_id = v.id and officer_id = auth.uid();
    if v_max is not null and v_used >= v_max then
      raise exception 'No attempts left (% of %)', v_used, v_max using errcode = 'DG011';
    end if;
    insert into public.assessment_attempts (assessment_id, officer_id, attempt_number)
    values (v.id, auth.uid(), v_used + 1)
    returning * into v_attempt;
  end if;

  if v.time_limit_minutes is not null
     and now() > v_attempt.started_at + make_interval(mins => v.time_limit_minutes + 1) then
    v_timed_out := true;
  end if;

  -- Grade.
  v_total := 0;
  v_earned := 0;
  for q in select * from public.questions where assessment_id = v.id loop
    v_total := v_total + q.points;
    begin
      select coalesce(array_agg(distinct x::uuid), '{}') into v_selected
        from jsonb_array_elements_text(coalesce(v_answers -> q.id::text, '[]'::jsonb)) x;
    exception when invalid_text_representation then
      raise exception 'Invalid answer for a question' using errcode = '22023';
    end;
    if exists (select 1 from unnest(v_selected) s
                where not exists (select 1 from public.question_options o
                                   where o.id = s and o.question_id = q.id)) then
      raise exception 'Answers name an option that is not in this question' using errcode = '22023';
    end if;
    if q.type <> 'multiple_choice' and cardinality(v_selected) > 1 then
      raise exception 'Choose one answer for "%"', left(q.prompt, 60) using errcode = '22023';
    end if;
    select coalesce(array_agg(o.id), '{}') into v_correct
      from public.question_options o where o.question_id = q.id and o.is_correct;
    if cardinality(v_selected) > 0
       and v_selected @> v_correct and v_correct @> v_selected then
      v_earned := v_earned + q.points;
    end if;
  end loop;

  v_score := case when v_timed_out or v_total = 0 then 0
                  else round(v_earned * 100.0 / v_total, 2) end;
  v_passed := not v_timed_out and v_total > 0 and v_score >= v.pass_mark_percent;

  update public.assessment_attempts
     set submitted_at = now(), answers = v_answers, score_percent = v_score,
         passed = v_passed, timed_out = v_timed_out
   where id = v_attempt.id
  returning * into v_attempt;

  -- Qualifications from the assignments that reach this officer.
  if v_passed then
    select time_zone into v_zone from public.settings where id;
    v_today := (now() at time zone coalesce(v_zone, 'UTC'))::date;
    insert into public.qualifications (user_id, type, issued_on, expires_on)
    select distinct on (btrim(a.creates_qualification_type))
           auth.uid(), btrim(a.creates_qualification_type), v_today,
           case when a.qualification_valid_months is null then null
                else (v_today + make_interval(months => a.qualification_valid_months))::date end
      from public.lesson_assignments a
     where a.lesson_id = v.lesson_id
       and a.creates_qualification_type is not null
       and public.lesson_assignment_applies_to_me(a.id)
       and not exists (select 1 from public.qualifications x
                        where x.user_id = auth.uid()
                          and x.type = btrim(a.creates_qualification_type)
                          and x.issued_on = v_today)
     order by btrim(a.creates_qualification_type), a.qualification_valid_months desc nulls first;
  end if;

  select count(*) into v_used from public.assessment_attempts
   where assessment_id = v.id and officer_id = auth.uid();

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'attempt_number', v_attempt.attempt_number,
    'score_percent', v_attempt.score_percent,
    'passed', v_attempt.passed,
    'timed_out', v_attempt.timed_out,
    'pass_mark_percent', v.pass_mark_percent,
    'attempts_left', case when v_max is null or v_passed then null
                          else greatest(v_max - v_used, 0) end,
    'review', case when public.assessment_answers_visible(v, auth.uid())
                   then public.attempt_review(v_attempt) end
  );
end;
$$;

create or replace function public.assessment_answers_visible(p_assessment public.assessments, p_officer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_assessment.show_correct_answers_after
    when 'never' then false
    when 'after_pass' then exists (
      select 1 from public.assessment_attempts
       where assessment_id = p_assessment.id and officer_id = p_officer and passed)
    else exists (
      select 1 from public.assessment_attempts
       where assessment_id = p_assessment.id and officer_id = p_officer and passed)
      or (public.effective_max_attempts(p_assessment, p_officer) is not null and (
        select count(*) from public.assessment_attempts
         where assessment_id = p_assessment.id and officer_id = p_officer
           and submitted_at is not null) >= public.effective_max_attempts(p_assessment, p_officer))
  end
$$;

-- ---------------------------------------------------------------------------
-- Question builder
-- ---------------------------------------------------------------------------

/**
 * Admins: save questions (each {id?, type, prompt, explanation, points,
 * sort_order?, options: [{id?, text, is_correct}]}) in one transaction. An id
 * that belongs to this assessment updates that question; otherwise a new one
 * is added at the end. Options are matched by id too; options left out are
 * deleted. Every question must be answerable. Returns the question ids.
 */
create function public.save_questions(p_assessment_id uuid, p_questions jsonb)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  q jsonb;
  o jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_type public.question_type;
  v_options jsonb;
  v_correct integer;
  v_keep uuid[];
  v_option_id uuid;
  v_next integer;
  i integer;
begin
  if not public.is_active_user() or public.auth_role() is distinct from 'admin' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.assessments where id = p_assessment_id) then
    raise exception 'Assessment not found' using errcode = '42501';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be a list' using errcode = '22023';
  end if;

  for q in select * from jsonb_array_elements(p_questions) loop
    v_type := (q ->> 'type')::public.question_type;
    v_options := coalesce(q -> 'options', '[]'::jsonb);
    select count(*) filter (where (e ->> 'is_correct')::boolean) into v_correct
      from jsonb_array_elements(v_options) e;
    if jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 10
       or (v_type = 'true_false' and jsonb_array_length(v_options) <> 2)
       or (v_type <> 'multiple_choice' and v_correct <> 1)
       or (v_type = 'multiple_choice' and v_correct < 1) then
      raise exception 'Check the options and correct answers of "%"', left(q ->> 'prompt', 80)
        using errcode = '22023';
    end if;

    v_id := nullif(q ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.questions
                                     where id = v_id and assessment_id = p_assessment_id) then
      update public.questions
         set type = v_type, prompt = q ->> 'prompt', explanation = nullif(btrim(q ->> 'explanation'), ''),
             points = coalesce((q ->> 'points')::integer, 1),
             sort_order = coalesce((q ->> 'sort_order')::integer, sort_order)
       where id = v_id;
    else
      select coalesce(max(sort_order), -1) + 1 into v_next
        from public.questions where assessment_id = p_assessment_id;
      insert into public.questions (assessment_id, type, prompt, explanation, points, sort_order)
      values (p_assessment_id, v_type, q ->> 'prompt', nullif(btrim(q ->> 'explanation'), ''),
              coalesce((q ->> 'points')::integer, 1),
              coalesce((q ->> 'sort_order')::integer, v_next))
      returning id into v_id;
    end if;

    -- Options: keep matching ids, add new ones, delete the rest.
    v_keep := '{}';
    i := 0;
    for o in select * from jsonb_array_elements(v_options) loop
      v_option_id := nullif(o ->> 'id', '')::uuid;
      if v_option_id is not null and exists (select 1 from public.question_options
                                              where id = v_option_id and question_id = v_id) then
        update public.question_options
           set text = o ->> 'text', is_correct = coalesce((o ->> 'is_correct')::boolean, false),
               sort_order = i
         where id = v_option_id;
      else
        insert into public.question_options (question_id, text, is_correct, sort_order)
        values (v_id, o ->> 'text', coalesce((o ->> 'is_correct')::boolean, false), i)
        returning id into v_option_id;
      end if;
      v_keep := v_keep || v_option_id;
      i := i + 1;
    end loop;
    delete from public.question_options where question_id = v_id and id <> all (v_keep);

    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;

/** Admins: set the order of an assessment's questions. */
create function public.reorder_questions(p_assessment_id uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_active_user() or public.auth_role() is distinct from 'admin' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.questions
     set sort_order = array_position(p_ids, id) - 1
   where assessment_id = p_assessment_id and id = any (p_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------

/**
 * Staff: every active person a lesson reaches, with where they are.
 * status: not_started | reading | ready_for_quiz | passed | failed
 *   passed  = a passing attempt (or, for a lesson without a quiz, reading done)
 *   failed  = no attempts left and never passed
 * overdue = the earliest due date of their assignments has passed and they
 * haven't passed. Runs as the caller: supervisors only get officers who share
 * a site with them.
 */
create function public.lesson_results(p_lesson_id uuid, p_now timestamptz default now())
returns table (
  officer_id uuid,
  officer_name text,
  status text,
  overdue boolean,
  due_at timestamptz,
  pages_viewed integer,
  page_count integer,
  seconds_spent integer,
  completed_reading_at timestamptz,
  attempts integer,
  attempts_allowed integer,
  best_score numeric,
  passed_at timestamptz,
  last_attempt_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lesson as (
    select l.id, l.page_count, a.id as assessment_id, a.max_attempts
      from public.lessons l
      left join public.assessments a on a.lesson_id = l.id
     where l.id = p_lesson_id
  ),
  reached as (
    select p.id, p.full_name, min(asg.due_at) as due_at
      from public.lesson_assignments asg
      join public.profiles p
        on p.employment_status = 'active'
       and (p.id = asg.officer_id
            or p.role = asg.role
            or (asg.site_id is not null and exists (
                  select 1 from public.site_assignments sa
                   where sa.site_id = asg.site_id and sa.officer_id = p.id)))
     where asg.lesson_id = p_lesson_id
     group by p.id, p.full_name
  ),
  base as (
    select r.id, r.full_name, r.due_at, l.page_count, l.assessment_id,
           pr.pages_viewed, pr.seconds_spent, pr.completed_reading_at,
           (pr.lesson_id is not null) as has_progress,
           (select count(*)::integer from public.assessment_attempts t
             where t.assessment_id = l.assessment_id and t.officer_id = r.id
               and t.submitted_at is not null) as attempts,
           case when l.assessment_id is null then null
                else public.effective_max_attempts(
                       (select a from public.assessments a where a.id = l.assessment_id), r.id) end
             as attempts_allowed,
           (select max(t.score_percent) from public.assessment_attempts t
             where t.assessment_id = l.assessment_id and t.officer_id = r.id
               and t.submitted_at is not null) as best_score,
           (select min(t.submitted_at) from public.assessment_attempts t
             where t.assessment_id = l.assessment_id and t.officer_id = r.id and t.passed) as passed_at,
           (select t.id from public.assessment_attempts t
             where t.assessment_id = l.assessment_id and t.officer_id = r.id
               and t.submitted_at is not null
             order by t.submitted_at desc limit 1) as last_attempt_id
      from reached r
      cross join lesson l
      left join public.lesson_progress pr on pr.lesson_id = l.id and pr.officer_id = r.id
     where public.is_staff()
       and (public.auth_role() = 'admin' or public.supervises_officer(r.id))
  ),
  judged as (
    select x.*,
           case
             when x.passed_at is not null
               or (x.assessment_id is null and x.completed_reading_at is not null) then 'passed'
             when x.attempts_allowed is not null and x.attempts >= x.attempts_allowed then 'failed'
             when x.completed_reading_at is not null then 'ready_for_quiz'
             when x.has_progress then 'reading'
             else 'not_started'
           end as status
      from base x
  )
  select j.id, j.full_name, j.status,
         (j.due_at is not null and j.due_at < p_now and j.status <> 'passed'),
         j.due_at, coalesce(cardinality(j.pages_viewed), 0), j.page_count,
         coalesce(j.seconds_spent, 0), j.completed_reading_at, j.attempts, j.attempts_allowed,
         j.best_score,
         case when j.passed_at is not null then j.passed_at
              when j.assessment_id is null then j.completed_reading_at end,
         j.last_attempt_id
    from judged j
   order by j.full_name
$$;

/**
 * Staff: per question, how many submitted (not timed-out) attempts got it
 * right. An unanswered question counts as wrong. Hardest first.
 */
create function public.lesson_question_stats(p_lesson_id uuid)
returns table (
  question_id uuid,
  prompt text,
  type public.question_type,
  sort_order integer,
  attempts integer,
  correct integer,
  wrong_percent numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with answered as (
    select q.id, q.prompt, q.type, q.sort_order, t.id as attempt_id,
           (select coalesce(array_agg(distinct x::uuid order by x::uuid), '{}')
              from jsonb_array_elements_text(coalesce(t.answers -> q.id::text, '[]'::jsonb)) x)
             as chosen,
           (select coalesce(array_agg(o.id order by o.id), '{}')
              from public.question_options o where o.question_id = q.id and o.is_correct)
             as key
      from public.questions q
      join public.assessments a on a.id = q.assessment_id and a.lesson_id = p_lesson_id
      left join public.assessment_attempts t
        on t.assessment_id = a.id and t.submitted_at is not null and not t.timed_out
     where public.is_staff()
  )
  select id, prompt, type, sort_order,
         count(attempt_id)::integer,
         count(attempt_id) filter (where cardinality(chosen) > 0 and chosen = key)::integer,
         case when count(attempt_id) = 0 then null
              else round(100.0 * (count(attempt_id) - count(attempt_id) filter (
                     where cardinality(chosen) > 0 and chosen = key)) / count(attempt_id), 1) end
    from answered
   group by id, prompt, type, sort_order
   order by 7 desc nulls last, sort_order
$$;

revoke execute on function
  public.effective_max_attempts(public.assessments, uuid),
  public.grant_extra_attempt(uuid, uuid, text),
  public.save_questions(uuid, jsonb),
  public.reorder_questions(uuid, uuid[]),
  public.lesson_results(uuid, timestamptz),
  public.lesson_question_stats(uuid)
  from public, anon;
grant execute on function
  public.effective_max_attempts(public.assessments, uuid),
  public.grant_extra_attempt(uuid, uuid, text),
  public.save_questions(uuid, jsonb),
  public.reorder_questions(uuid, uuid[]),
  public.lesson_results(uuid, timestamptz),
  public.lesson_question_stats(uuid)
  to authenticated;
