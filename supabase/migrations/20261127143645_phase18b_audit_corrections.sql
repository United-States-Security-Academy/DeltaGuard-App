-- Phase 18b: corrections after running every pgTAP suite against phase 18.
--
--   1. effective_max_attempts(): phase 18 revoked it from authenticated, but
--      lesson_results() (SECURITY INVOKER, console Results tab) calls it as the
--      staff member, so the tab broke. Granted back, and the function now
--      answers only staff, or an officer about their own allowance (the
--      quiz functions call it with auth.uid()).
--   2. messages_before_insert(): phase 18 added a folder check that already
--      exists as a CHECK constraint on messages.attachment_path (phase 11). The
--      duplicate is removed so the constraint (23514) stays the one rule.

create or replace function public.effective_max_attempts(p_assessment public.assessments, p_officer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (public.is_staff() or p_officer = auth.uid()) then null
    when p_assessment.max_attempts is null then null
    else p_assessment.max_attempts + coalesce((
      select sum(g.extra_attempts)::integer from public.assessment_attempt_grants g
       where g.assessment_id = p_assessment.id and g.officer_id = p_officer), 0)
  end
$$;
grant execute on function public.effective_max_attempts(public.assessments, uuid) to authenticated;

create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  if new.attachment_path is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'chat-attachments' and o.name = new.attachment_path
  ) then
    raise exception 'The photo hasn''t finished uploading' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
