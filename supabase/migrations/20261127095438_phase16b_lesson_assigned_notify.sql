-- Phase 16b: notify everyone a new lesson assignment reaches (the officer, or
-- every active user at the site, or every active user with the role).
-- Same path as every alert: notify_users() -> inbox row + push through the
-- send-notification Edge Function. Type `lesson_assigned`, deduped per user
-- per assignment.

create function public.notify_lesson_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons;
  v_zone text;
  v_users uuid[];
  v_body text;
begin
  select * into v_lesson from public.lessons where id = new.lesson_id;
  select time_zone into v_zone from public.settings where id;

  select coalesce(array_agg(p.id), '{}') into v_users
    from public.profiles p
   where p.employment_status = 'active'
     and (p.id = new.officer_id
          or p.role = new.role
          or (new.site_id is not null and exists (
                select 1 from public.site_assignments sa
                 where sa.site_id = new.site_id and sa.officer_id = p.id)));

  v_body := concat_ws(' ',
    case when new.due_at is not null
         then 'Due ' || to_char(new.due_at at time zone coalesce(v_zone, 'UTC'), 'Mon FMDD, FMHH12:MI AM') || '.'
    end,
    case when v_lesson.estimated_minutes is not null
         then 'About ' || v_lesson.estimated_minutes || ' min.'
    end,
    case when new.creates_qualification_type is not null
         then 'Passing gives you the ' || new.creates_qualification_type || ' qualification.'
    end,
    'Open it in the DeltaGuard app.'
  );

  perform public.notify_users(
    v_users,
    'lesson_assigned',
    'New training: ' || coalesce(v_lesson.title, 'lesson'),
    v_body,
    jsonb_build_object('lesson_id', new.lesson_id, 'assignment_id', new.id),
    'lesson_assigned:' || new.id
  );
  return null;
end;
$$;

create trigger lesson_assignments_notify
  after insert on public.lesson_assignments
  for each row execute function public.notify_lesson_assigned();

revoke execute on function public.notify_lesson_assigned() from public, anon, authenticated;
