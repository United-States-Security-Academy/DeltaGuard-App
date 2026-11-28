-- Phase 16: training. Lessons (a PDF read page by page), an optional
-- assessment per lesson, assignments, reading progress and graded attempts.
--
-- lessons               the PDF and its page images (private `lesson-files`
--                       bucket, <lesson_id>/...). Content edits after the
--                       first publish raise `version`.
-- assessments           one per lesson: pass mark, attempts, time limit,
--                       shuffling, when correct answers may be shown.
-- questions             single_choice | multiple_choice | true_false
-- question_options      the choices, with is_correct
-- lesson_assignments    exactly one of officer / site / role; optional due
--                       date; a pass can create a qualification
-- lesson_progress       pages viewed, time spent, completed_reading_at
-- assessment_attempts   one row per attempt (started when the quiz opens)
--
-- The answer key never reaches an officer:
--   * officers have NO access to questions or question_options (the
--     explanations give answers away too);
--   * get_assessment_for_officer() returns the quiz without is_correct or
--     explanations, in a per-attempt shuffled order, and only once reading is
--     complete. Opening the quiz starts the attempt (server time), which is
--     what the time limit is measured from;
--   * submit_attempt() (SECURITY DEFINER) grades on the server, enforces the
--     attempt limit and the time limit, and returns the result. Correct
--     answers are shown only as show_correct_answers_after allows.
--   * completed_reading_at is set only by record_lesson_progress(), when every
--     page has been viewed. Officers can't write progress or attempts directly.
--
-- Access summary (every policy also requires is_active_user()):
--   admin       everything
--   supervisor  reads lessons (not drafts), assessments, questions, options
--               and assignments; reads progress and attempts of officers who
--               share a site with them (site_assignments)
--   officer     reads published lessons assigned to them (directly, via a
--               site, or via their role), their assessments' settings, their
--               own assignments, progress and attempts
--
-- SQLSTATEs for the app: DG010 reading not complete, DG011 no attempts left,
-- DG012 already passed.

create type public.lesson_status as enum ('draft', 'published', 'archived');
create type public.question_type as enum ('single_choice', 'multiple_choice', 'true_false');
create type public.show_answers_after as enum ('never', 'after_pass', 'after_final_attempt');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 4000),
  pdf_path text check (char_length(pdf_path) <= 500),
  page_count integer check (page_count between 1 and 500),
  page_image_paths text[] not null default '{}',
  estimated_minutes integer check (estimated_minutes between 1 and 600),
  version integer not null default 1 check (version >= 1),
  status public.lesson_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons (id) on delete cascade,
  pass_mark_percent integer not null default 70 check (pass_mark_percent between 1 and 100),
  max_attempts integer check (max_attempts between 1 and 100),
  time_limit_minutes integer check (time_limit_minutes between 1 and 600),
  shuffle_questions boolean not null default false,
  shuffle_options boolean not null default false,
  show_correct_answers_after public.show_answers_after not null default 'never',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  type public.question_type not null,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 2000),
  explanation text check (char_length(explanation) <= 4000),
  points integer not null default 1 check (points between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index questions_assessment_id_idx on public.questions (assessment_id, sort_order);

create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 500),
  is_correct boolean not null default false,
  sort_order integer not null default 0
);

create index question_options_question_id_idx on public.question_options (question_id, sort_order);

create table public.lesson_assignments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  officer_id uuid references public.profiles (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  role public.user_role,
  due_at timestamptz,
  -- A pass creates this qualification (e.g. "Fire safety"), valid this long
  -- (null = no expiry).
  creates_qualification_type text check (char_length(btrim(creates_qualification_type)) between 1 and 100),
  qualification_valid_months integer check (qualification_valid_months between 1 and 240),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(officer_id, site_id, role) = 1),
  check (qualification_valid_months is null or creates_qualification_type is not null)
);

create index lesson_assignments_lesson_id_idx on public.lesson_assignments (lesson_id);
create index lesson_assignments_officer_id_idx on public.lesson_assignments (officer_id) where officer_id is not null;
create index lesson_assignments_site_id_idx on public.lesson_assignments (site_id) where site_id is not null;

create table public.lesson_progress (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  officer_id uuid not null references public.profiles (id) on delete cascade,
  pages_viewed integer[] not null default '{}',
  seconds_spent integer not null default 0 check (seconds_spent >= 0),
  completed_reading_at timestamptz,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lesson_id, officer_id)
);

create index lesson_progress_officer_id_idx on public.lesson_progress (officer_id);

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  officer_id uuid not null references public.profiles (id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  -- {"<question id>": ["<option id>", ...]}
  answers jsonb check (answers is null or jsonb_typeof(answers) = 'object'),
  score_percent numeric(5, 2) check (score_percent between 0 and 100),
  passed boolean,
  -- Submitted after the time limit (plus a minute's grace): scored 0.
  timed_out boolean not null default false,
  unique (assessment_id, officer_id, attempt_number),
  check (submitted_at is null or (score_percent is not null and passed is not null))
);

create index assessment_attempts_officer_idx on public.assessment_attempts (officer_id, assessment_id);
-- At most one open (not submitted) attempt per officer and assessment.
create unique index assessment_attempts_one_open
  on public.assessment_attempts (assessment_id, officer_id) where submitted_at is null;

-- ---------------------------------------------------------------------------
-- Access helpers (security definer; each answers only about the caller)
-- ---------------------------------------------------------------------------

/** Internal: an assignment of the lesson reaches the user (directly, site, or role). */
create function public.lesson_assigned_to(p_lesson_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.lesson_assignments a
      join public.profiles p on p.id = p_user
     where a.lesson_id = p_lesson_id
       and (a.officer_id = p_user
            or a.role = p.role
            or (a.site_id is not null and exists (
                  select 1 from public.site_assignments sa
                   where sa.site_id = a.site_id and sa.officer_id = p_user)))
  )
$$;

/** The lesson is published and assigned to the caller. */
create function public.lesson_visible_to_me(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_active_user()
    and exists (select 1 from public.lessons l where l.id = p_lesson_id and l.status = 'published')
    and public.lesson_assigned_to(p_lesson_id, auth.uid()),
    false
  )
$$;

/** The assignment reaches the caller. */
create function public.lesson_assignment_applies_to_me(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_active_user() and exists (
    select 1 from public.lesson_assignments a
      join public.profiles p on p.id = auth.uid()
     where a.id = p_assignment_id
       and (a.officer_id = p.id
            or a.role = p.role
            or (a.site_id is not null and exists (
                  select 1 from public.site_assignments sa
                   where sa.site_id = a.site_id and sa.officer_id = p.id)))
  ), false)
$$;

/** The caller is an active supervisor who shares a site with the officer. */
create function public.supervises_officer(p_officer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_active_user()
    and public.auth_role() = 'supervisor'
    and exists (
      select 1 from public.site_assignments mine
        join public.site_assignments theirs on theirs.site_id = mine.site_id
       where mine.officer_id = auth.uid() and theirs.officer_id = p_officer_id
    ),
    false
  )
$$;

/** lesson-files/<lesson_id>/...: readable by officers the lesson is assigned to. */
create function public.can_read_lesson_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.lesson_visible_to_me(((storage.foldername(p_name))[1])::uuid)
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.lessons_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      new.created_by := auth.uid();
    end if;
    new.version := 1;
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- New content after the first publish is a new version.
    if (new.pdf_path, new.page_count, new.page_image_paths)
       is distinct from (old.pdf_path, old.page_count, old.page_image_paths)
       and old.status <> 'draft' then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;

  if new.pdf_path is not null and new.pdf_path not like new.id::text || '/%' then
    raise exception 'The PDF must be in the lesson''s folder' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.page_image_paths) p
              where p is null or p not like new.id::text || '/%') then
    raise exception 'Page images must be in the lesson''s folder' using errcode = '22023';
  end if;

  if new.status = 'published' then
    if new.pdf_path is null or new.page_count is null
       or cardinality(new.page_image_paths) <> new.page_count then
      raise exception 'Upload the PDF (and its page images) before publishing the lesson'
        using errcode = 'P0001';
    end if;
    -- Every question of its assessment must be answerable.
    select q.prompt into v_bad
      from public.assessments a
      join public.questions q on q.assessment_id = a.id
     where a.lesson_id = new.id
       and (
         (select count(*) from public.question_options o where o.question_id = q.id) < 2
         or (q.type = 'true_false'
             and (select count(*) from public.question_options o where o.question_id = q.id) <> 2)
         or (q.type in ('single_choice', 'true_false')
             and (select count(*) from public.question_options o
                   where o.question_id = q.id and o.is_correct) <> 1)
         or (q.type = 'multiple_choice'
             and (select count(*) from public.question_options o
                   where o.question_id = q.id and o.is_correct) < 1)
       )
     limit 1;
    if v_bad is not null then
      raise exception 'Fix this question before publishing: "%" (check its options and correct answers)',
        left(v_bad, 80) using errcode = 'P0001';
    end if;
    if exists (select 1 from public.assessments a where a.lesson_id = new.id)
       and not exists (select 1 from public.assessments a
                         join public.questions q on q.assessment_id = a.id
                        where a.lesson_id = new.id) then
      raise exception 'The assessment has no questions' using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger lessons_before_write
  before insert or update on public.lessons
  for each row execute function public.lessons_before_write();

create function public.lesson_assignments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.lessons where id = new.lesson_id and status = 'published') then
      raise exception 'Publish the lesson before assigning it' using errcode = 'P0001';
    end if;
    if current_user in ('anon', 'authenticated') then
      new.created_by := auth.uid();
    end if;
    new.created_at := now();
  else
    new.lesson_id := old.lesson_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger lesson_assignments_before_write
  before insert or update on public.lesson_assignments
  for each row execute function public.lesson_assignments_before_write();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger assessments_touch before update on public.assessments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Officer functions
-- ---------------------------------------------------------------------------

/**
 * Officers: record pages viewed and time spent on a lesson. Reading is
 * complete (completed_reading_at, set once) when every page has been viewed.
 * At most an hour of time is counted per call.
 */
create function public.record_lesson_progress(
  p_lesson_id uuid,
  p_pages integer[],
  p_seconds integer default 0
)
returns public.lesson_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons;
  v_row public.lesson_progress;
  v_pages integer[];
begin
  if not public.lesson_visible_to_me(p_lesson_id) then
    raise exception 'Lesson not found' using errcode = '42501';
  end if;
  select * into v_lesson from public.lessons where id = p_lesson_id;
  if exists (select 1 from unnest(coalesce(p_pages, '{}')) p where p is null or p < 1 or p > v_lesson.page_count) then
    raise exception 'Invalid page number' using errcode = '22023';
  end if;
  if p_seconds is null or p_seconds < 0 then
    raise exception 'Invalid time' using errcode = '22023';
  end if;

  insert into public.lesson_progress (lesson_id, officer_id)
  values (p_lesson_id, auth.uid())
  on conflict (lesson_id, officer_id) do nothing;

  select * into v_row from public.lesson_progress
   where lesson_id = p_lesson_id and officer_id = auth.uid()
   for update;

  select coalesce(array_agg(distinct p order by p), '{}') into v_pages
    from unnest(v_row.pages_viewed || coalesce(p_pages, '{}')) p;

  update public.lesson_progress
     set pages_viewed = v_pages,
         seconds_spent = seconds_spent + least(p_seconds, 3600),
         completed_reading_at = coalesce(
           completed_reading_at,
           case when (select count(*) from unnest(v_pages) p where p between 1 and v_lesson.page_count)
                     >= v_lesson.page_count
                then now() end
         ),
         updated_at = now()
   where lesson_id = p_lesson_id and officer_id = auth.uid()
  returning * into v_row;
  return v_row;
end;
$$;

/** Internal: the caller may take this assessment (visible lesson, reading complete). */
create function public.assessment_gate(p_assessment_id uuid)
returns public.assessments
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.assessments;
begin
  select * into v from public.assessments where id = p_assessment_id;
  if not found or not public.lesson_visible_to_me(v.lesson_id) then
    raise exception 'Assessment not found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.lesson_progress pr
     where pr.lesson_id = v.lesson_id and pr.officer_id = auth.uid()
       and pr.completed_reading_at is not null
  ) then
    raise exception 'Finish reading the lesson before starting the quiz' using errcode = 'DG010';
  end if;
  return v;
end;
$$;

/** Internal: close an open attempt whose time ran out (score 0). */
create function public.expire_open_attempt(p_assessment public.assessments, p_officer uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.assessment_attempts
     set submitted_at = now(), answers = '{}', score_percent = 0, passed = false, timed_out = true
   where assessment_id = p_assessment.id and officer_id = p_officer and submitted_at is null
     and p_assessment.time_limit_minutes is not null
     and now() > started_at + make_interval(mins => p_assessment.time_limit_minutes + 1)
$$;

/**
 * Officers: open the quiz. Starts an attempt (or resumes the open one) and
 * returns its questions WITHOUT the answer key or explanations, shuffled per
 * attempt when the assessment says so. Refuses until reading is complete
 * (DG010), when no attempts are left (DG011) or after a pass (DG012).
 */
create function public.get_assessment_for_officer(p_assessment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessments;
  v_attempt public.assessment_attempts;
  v_used integer;
begin
  v := public.assessment_gate(p_assessment_id);
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
    if v.max_attempts is not null and v_used >= v.max_attempts then
      raise exception 'No attempts left (% of %)', v_used, v.max_attempts using errcode = 'DG011';
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
    'max_attempts', v.max_attempts,
    'time_limit_minutes', v.time_limit_minutes,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'attempt_number', v_attempt.attempt_number,
      'started_at', v_attempt.started_at,
      'expires_at', case when v.time_limit_minutes is null then null
                         else v_attempt.started_at + make_interval(mins => v.time_limit_minutes) end,
      'attempts_left', case when v.max_attempts is null then null else v.max_attempts - v_used end
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

/** Internal: whether the officer may now see correct answers. */
create function public.assessment_answers_visible(p_assessment public.assessments, p_officer uuid)
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
      or (p_assessment.max_attempts is not null and (
        select count(*) from public.assessment_attempts
         where assessment_id = p_assessment.id and officer_id = p_officer
           and submitted_at is not null) >= p_assessment.max_attempts)
  end
$$;

/** Internal: per-question review (your answer, the correct one, explanation). */
create function public.attempt_review(p_attempt public.assessment_attempts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'question_id', q.id,
           'prompt', q.prompt,
           'explanation', q.explanation,
           'your_option_ids', coalesce(p_attempt.answers -> q.id::text, '[]'::jsonb),
           'correct_option_ids', (select coalesce(jsonb_agg(o.id order by o.sort_order), '[]'::jsonb)
                                    from public.question_options o
                                   where o.question_id = q.id and o.is_correct),
           'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text)
                                         order by o.sort_order), '[]'::jsonb)
                         from public.question_options o where o.question_id = q.id)
         ) order by q.sort_order, q.id), '[]'::jsonb)
    from public.questions q
   where q.assessment_id = p_attempt.assessment_id
$$;

/**
 * Officers: submit answers {"<question id>": ["<option id>", ...]} for the
 * open attempt (one is started if none is open). Grades on the server:
 * single_choice / true_false = the one correct option; multiple_choice = all
 * the correct options and none of the others. Score = points earned / total
 * points. Past the time limit (+1 minute grace) the attempt scores 0. A pass
 * on an assignment with creates_qualification_type adds that qualification.
 */
create function public.submit_attempt(p_assessment_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessments;
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
    if v.max_attempts is not null and v_used >= v.max_attempts then
      raise exception 'No attempts left (% of %)', v_used, v.max_attempts using errcode = 'DG011';
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
    'attempts_left', case when v.max_attempts is null or v_passed then null
                          else greatest(v.max_attempts - v_used, 0) end,
    'review', case when public.assessment_answers_visible(v, auth.uid())
                   then public.attempt_review(v_attempt) end
  );
end;
$$;

/** Officers: the review of one of their submitted attempts, when answers may be shown. */
create function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_attempt public.assessment_attempts;
  v public.assessments;
begin
  select * into v_attempt from public.assessment_attempts
   where id = p_attempt_id and officer_id = auth.uid() and submitted_at is not null;
  if not found or not public.is_active_user() then
    raise exception 'Attempt not found' using errcode = '42501';
  end if;
  select * into v from public.assessments where id = v_attempt.assessment_id;
  if not public.assessment_answers_visible(v, auth.uid()) then
    raise exception 'Correct answers are not shown for this assessment yet' using errcode = 'P0001';
  end if;
  return public.attempt_review(v_attempt);
end;
$$;

-- Internal helpers: not callable through the API.
revoke execute on function
  public.lesson_assigned_to(uuid, uuid),
  public.assessment_gate(uuid),
  public.expire_open_attempt(public.assessments, uuid),
  public.assessment_answers_visible(public.assessments, uuid),
  public.attempt_review(public.assessment_attempts)
  from public, anon, authenticated;

revoke execute on function
  public.lesson_visible_to_me(uuid),
  public.lesson_assignment_applies_to_me(uuid),
  public.supervises_officer(uuid),
  public.can_read_lesson_file(text),
  public.record_lesson_progress(uuid, integer[], integer),
  public.get_assessment_for_officer(uuid),
  public.submit_attempt(uuid, jsonb),
  public.get_attempt_review(uuid)
  from public, anon;
grant execute on function
  public.lesson_visible_to_me(uuid),
  public.lesson_assignment_applies_to_me(uuid),
  public.supervises_officer(uuid),
  public.can_read_lesson_file(text),
  public.record_lesson_progress(uuid, integer[], integer),
  public.get_assessment_for_officer(uuid),
  public.submit_attempt(uuid, jsonb),
  public.get_attempt_review(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (this project grants new tables to API roles explicitly)
-- ---------------------------------------------------------------------------

alter table public.lessons enable row level security;
alter table public.assessments enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.lesson_assignments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.assessment_attempts enable row level security;

revoke all on public.lessons, public.assessments, public.questions, public.question_options,
  public.lesson_assignments, public.lesson_progress, public.assessment_attempts
  from anon, authenticated;
grant select, insert, update, delete on public.lessons, public.assessments, public.questions,
  public.question_options, public.lesson_assignments, public.lesson_progress,
  public.assessment_attempts to authenticated;
grant all on public.lessons, public.assessments, public.questions, public.question_options,
  public.lesson_assignments, public.lesson_progress, public.assessment_attempts to service_role;

-- Admins: everything.
create policy "lessons: admins full access" on public.lessons for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
create policy "assessments: admins full access" on public.assessments for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
create policy "questions: admins full access" on public.questions for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
create policy "question_options: admins full access" on public.question_options for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
create policy "lesson_assignments: admins full access" on public.lesson_assignments for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
create policy "lesson_progress: admins full access" on public.lesson_progress for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
create policy "assessment_attempts: admins full access" on public.assessment_attempts for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- Supervisors: content (not drafts) and assignments; progress and attempts
-- of officers who share a site with them.
create policy "lessons: supervisors read non-draft" on public.lessons for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'supervisor'
         and status <> 'draft');
create policy "assessments: supervisors read" on public.assessments for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'supervisor');
create policy "questions: supervisors read" on public.questions for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'supervisor');
create policy "question_options: supervisors read" on public.question_options for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'supervisor');
create policy "lesson_assignments: supervisors read" on public.lesson_assignments for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'supervisor');
create policy "lesson_progress: supervisors read for their sites" on public.lesson_progress
  for select to authenticated using (public.supervises_officer(officer_id));
create policy "assessment_attempts: supervisors read for their sites" on public.assessment_attempts
  for select to authenticated using (public.supervises_officer(officer_id));

-- Officers: published lessons assigned to them, their assessments' settings
-- (never questions or options: see get_assessment_for_officer), their own
-- assignments, progress and attempts. No writes: progress and attempts go
-- through record_lesson_progress() and submit_attempt().
create policy "lessons: officers read published and assigned" on public.lessons
  for select to authenticated using (public.lesson_visible_to_me(id));
create policy "assessments: officers read for assigned lessons" on public.assessments
  for select to authenticated using (public.lesson_visible_to_me(lesson_id));
create policy "lesson_assignments: officers read their own" on public.lesson_assignments
  for select to authenticated
  using (public.lesson_assignment_applies_to_me(id) and public.lesson_visible_to_me(lesson_id));
create policy "lesson_progress: officers read their own" on public.lesson_progress
  for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));
create policy "assessment_attempts: officers read their own" on public.assessment_attempts
  for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: private `lesson-files` bucket, <lesson_id>/<upload>/original.pdf
-- and page-<n>.png (admins upload from the console)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('lesson-files', 'lesson-files', false, 100 * 1024 * 1024,
   array['application/pdf', 'image/png', 'image/jpeg']);

create policy "lesson-files: admins full access" on storage.objects for all to authenticated
  using (bucket_id = 'lesson-files' and (select public.is_active_user())
         and (select public.auth_role()) = 'admin')
  with check (bucket_id = 'lesson-files' and (select public.is_active_user())
              and (select public.auth_role()) = 'admin');

create policy "lesson-files: supervisors read" on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files' and (select public.is_active_user())
         and (select public.auth_role()) = 'supervisor');

create policy "lesson-files: officers read assigned lessons" on storage.objects
  for select to authenticated
  using (bucket_id = 'lesson-files' and public.can_read_lesson_file(name));
