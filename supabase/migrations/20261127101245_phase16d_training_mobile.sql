-- Phase 16d: what the phone's Training screen needs.
--
--   assessment_overview(id)     officers: the quiz rules (question count,
--                               pass mark, attempts used / left, time limit,
--                               an open attempt, passed) WITHOUT starting an
--                               attempt, so the rules screen doesn't start
--                               the clock. Reveals no questions.
--   notify_lessons_due_soon()   pg_cron, hourly: a reminder to everyone an
--                               assignment reaches who hasn't passed yet,
--                               when it is due within 2 days. Once per person
--                               per assignment (dedupe_key). Only for
--                               assignments made more than 2 days before
--                               their due date: otherwise the "new training"
--                               alert is the reminder.

create function public.assessment_overview(p_assessment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.assessments;
  v_max integer;
  v_used integer;
  v_open public.assessment_attempts;
  v_reading_done boolean;
begin
  select * into v from public.assessments where id = p_assessment_id;
  if not found or not public.lesson_visible_to_me(v.lesson_id) then
    raise exception 'Assessment not found' using errcode = '42501';
  end if;
  v_max := public.effective_max_attempts(v, auth.uid());
  select count(*) into v_used from public.assessment_attempts
   where assessment_id = v.id and officer_id = auth.uid() and submitted_at is not null;
  select * into v_open from public.assessment_attempts
   where assessment_id = v.id and officer_id = auth.uid() and submitted_at is null;
  select exists (select 1 from public.lesson_progress
                  where lesson_id = v.lesson_id and officer_id = auth.uid()
                    and completed_reading_at is not null) into v_reading_done;

  return jsonb_build_object(
    'assessment_id', v.id,
    'lesson_id', v.lesson_id,
    'question_count', (select count(*) from public.questions where assessment_id = v.id),
    'total_points', (select coalesce(sum(points), 0) from public.questions where assessment_id = v.id),
    'pass_mark_percent', v.pass_mark_percent,
    'time_limit_minutes', v.time_limit_minutes,
    'max_attempts', v_max,
    'attempts_used', v_used,
    'attempts_left', case when v_max is null then null else greatest(v_max - v_used, 0) end,
    'passed', exists (select 1 from public.assessment_attempts
                       where assessment_id = v.id and officer_id = auth.uid() and passed),
    'reading_complete', v_reading_done,
    'show_correct_answers_after', v.show_correct_answers_after,
    'open_attempt', case when v_open.id is null then null else jsonb_build_object(
      'id', v_open.id,
      'started_at', v_open.started_at,
      'expires_at', case when v.time_limit_minutes is null then null
                         else v_open.started_at + make_interval(mins => v.time_limit_minutes) end
    ) end
  );
end;
$$;

revoke execute on function public.assessment_overview(uuid) from public, anon;
grant execute on function public.assessment_overview(uuid) to authenticated;

/** Hourly: "due in 2 days" reminders. Returns how many were created. */
create function public.notify_lessons_due_soon(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_count integer := 0;
  a record;
  v_users uuid[];
begin
  select time_zone into v_zone from public.settings where id;

  for a in
    select asg.id, asg.lesson_id, asg.officer_id, asg.site_id, asg.role, asg.due_at, l.title,
           (select x.id from public.assessments x where x.lesson_id = l.id) as assessment_id
      from public.lesson_assignments asg
      join public.lessons l on l.id = asg.lesson_id and l.status = 'published'
     where asg.due_at > p_now
       and asg.due_at <= p_now + interval '2 days'
       and asg.created_at < asg.due_at - interval '2 days'
  loop
    select coalesce(array_agg(p.id), '{}') into v_users
      from public.profiles p
     where p.employment_status = 'active'
       and (p.id = a.officer_id
            or p.role = a.role
            or (a.site_id is not null and exists (
                  select 1 from public.site_assignments sa
                   where sa.site_id = a.site_id and sa.officer_id = p.id)))
       -- Not done yet: no pass (or, without a quiz, reading not finished).
       and not (
         case when a.assessment_id is null then exists (
                select 1 from public.lesson_progress pr
                 where pr.lesson_id = a.lesson_id and pr.officer_id = p.id
                   and pr.completed_reading_at is not null)
              else exists (
                select 1 from public.assessment_attempts t
                 where t.assessment_id = a.assessment_id and t.officer_id = p.id and t.passed)
         end
       );

    v_count := v_count + public.notify_users(
      v_users,
      'lesson_due_soon',
      'Training due soon: ' || a.title,
      'Due ' || to_char(a.due_at at time zone coalesce(v_zone, 'UTC'), 'Dy Mon FMDD, FMHH12:MI AM')
        || '. Finish the lesson' || case when a.assessment_id is null then '' else ' and pass the quiz' end
        || ' in the DeltaGuard app.',
      jsonb_build_object('lesson_id', a.lesson_id, 'assignment_id', a.id),
      'lesson_due_soon:' || a.id
    );
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.notify_lessons_due_soon(timestamptz) from public, anon, authenticated;

select cron.schedule('notify-lessons-due-soon', '25 * * * *', 'select public.notify_lessons_due_soon()');
