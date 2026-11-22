-- Phase 9b: claim notifications before pushing them.
--
-- Two deliveries can run at once (the pg_net call right after a row is
-- created, the 5-minute maintenance run, a direct send). Each one first
-- claims its rows (pending -> sending, FOR UPDATE SKIP LOCKED), so a row is
-- pushed by exactly one of them. A claim older than 10 minutes (the function
-- crashed mid-way) is released by the next maintenance run.

alter table public.notifications drop constraint notifications_push_status_check;
alter table public.notifications add constraint notifications_push_status_check
  check (push_status in ('pending', 'sending', 'sent', 'no_device', 'failed'));
alter table public.notifications add column claimed_at timestamptz;

/**
 * Claims pending rows for delivery: these ids, or (null) everything pending
 * from the last 24 hours. Returns the claimed rows.
 */
create function public.claim_notifications(p_ids uuid[] default null)
returns setof public.notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ids is null then
    update public.notifications
       set push_status = 'pending'
     where push_status = 'sending' and claimed_at < now() - interval '10 minutes';
  end if;

  return query
    update public.notifications n
       set push_status = 'sending', claimed_at = now()
     where n.id in (
       select c.id from public.notifications c
        where c.push_status = 'pending'
          and (case when p_ids is null then c.created_at > now() - interval '24 hours'
                    else c.id = any(p_ids) end)
        order by c.created_at
        limit 500
        for update skip locked
     )
    returning n.*;
end;
$$;

revoke execute on function public.claim_notifications from public, anon, authenticated;
grant execute on function public.claim_notifications to service_role;
