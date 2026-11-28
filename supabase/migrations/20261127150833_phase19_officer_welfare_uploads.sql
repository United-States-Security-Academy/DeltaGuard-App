-- Phase 19: per-officer welfare settings, quiz allowance hardening, and
-- verification of every uploaded file's content.
--
-- 1. officer_welfare_settings (admins): an officer can have their OWN policy,
--    or checks switched off, whatever their site says. No row = follow the
--    site (or the company default). Precedence:
--      officer setting  >  site policy (if checks are on at the site)  >  company default
--    Changing an officer's setting while they are on duty replaces their next
--    (not yet prompted) check at once, with the new policy's timing.
-- 2. effective_max_attempts() answers 0 (not "unlimited") to anyone who may not
--    ask, so a wrong caller can never read it as "no limit".
-- 3. Uploads: every new or replaced file in Storage gets an upload_checks row.
--    Files uploaded with the service role (the server's own PDFs) are trusted;
--    everything else is 'pending' until the Edge Function verify-upload has
--    parsed it (_shared/image-check.ts: real JPEG / PNG / PDF, nothing after
--    the end of the image, no script in metadata). Until then only the
--    uploader can read it (restrictive SELECT policy); a file that fails is
--    deleted and the attempt audited ('upload_rejected'). HEIC and WebP are no
--    longer accepted (they can't be checked): the apps re-encode to JPEG.

-- ---------------------------------------------------------------------------
-- 1. Per-officer welfare settings
-- ---------------------------------------------------------------------------

create table public.officer_welfare_settings (
  officer_id uuid primary key references public.profiles (id) on delete cascade,
  -- 'policy': use policy_id; 'off': this officer gets no welfare checks.
  mode text not null check (mode in ('policy', 'off')),
  policy_id uuid references public.welfare_check_policies (id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  check ((mode = 'policy') = (policy_id is not null))
);
comment on table public.officer_welfare_settings is
  'An officer''s own welfare check policy (or checks off), overriding their site and the company default. Admins only.';

alter table public.officer_welfare_settings enable row level security;
create policy "officer_welfare_settings: staff read"
  on public.officer_welfare_settings for select to authenticated
  using ((select public.is_staff()));
create policy "officer_welfare_settings: admins write"
  on public.officer_welfare_settings for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
grant select, insert, update, delete on public.officer_welfare_settings to authenticated;
grant all on public.officer_welfare_settings to service_role;

/** The enabled policy for this officer at this site, or null (no checks). */
create function public.welfare_policy_for(p_officer_id uuid, p_site_id uuid)
returns public.welfare_check_policies
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.welfare_check_policies p
   where p.enabled
     and p.id = (
       select case
         when o.mode = 'off' then null
         when o.mode = 'policy' then o.policy_id
         when coalesce(s.welfare_checks_enabled, false)
           then coalesce(s.welfare_policy_id, (select st.welfare_policy_id from public.settings st where st.id))
       end
         from (select 1) one
         left join public.officer_welfare_settings o on o.officer_id = p_officer_id
         left join public.sites s on s.id = p_site_id
     )
$$;
revoke execute on function public.welfare_policy_for from public, anon, authenticated;

-- welfare_schedule_next as in phase 17b, with the officer's own setting.
create or replace function public.welfare_schedule_next(p_shift_id uuid, p_from timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_policy public.welfare_check_policies;
  v_range integer[];
  v_at timestamptz;
  v_id uuid;
begin
  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.id is null or v_shift.status <> 'in_progress' then
    return null;
  end if;
  if public.welfare_shift_paused(p_shift_id) then
    return null;
  end if;
  v_policy := public.welfare_policy_for(v_shift.officer_id, v_shift.site_id);
  if v_policy.id is null then
    return null;
  end if;

  v_range := public.welfare_interval_minutes(v_policy.id, p_from);
  v_at := p_from + make_interval(secs => v_range[1] * 60
            + floor(random() * ((v_range[2] - v_range[1]) * 60 + 1)));
  if v_at >= v_shift.ends_at then
    return null;
  end if;

  insert into public.welfare_checks (
    shift_id, officer_id, site_id, policy_id, policy, scheduled_at, step_due_at, escalation_log
  ) values (
    v_shift.id, v_shift.officer_id, v_shift.site_id, v_policy.id,
    jsonb_build_object(
      'name', v_policy.name,
      'interval_minutes', to_jsonb(v_range),
      'night', public.welfare_is_night(v_policy, p_from),
      'response_seconds', v_policy.response_seconds,
      'alarm_seconds', v_policy.alarm_seconds,
      'call_attempts', v_policy.call_attempts,
      'call_gap_seconds', v_policy.call_gap_seconds,
      'supervisor_alert_after_seconds', v_policy.supervisor_alert_after_seconds
    ),
    v_at, v_at,
    jsonb_build_array(jsonb_build_object('at', now(), 'step', 'scheduled', 'scheduled_at', v_at))
  )
  on conflict (shift_id) where status in ('scheduled', 'prompted', 'alarm', 'calling') do nothing
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Stamps who changed the setting; while the officer is on duty, swaps their
 * next (not yet prompted) check for one under the new setting; audits it.
 */
create function public.officer_welfare_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger officer_welfare_settings_before_write
  before insert or update on public.officer_welfare_settings
  for each row execute function public.officer_welfare_settings_before_write();

create function public.officer_welfare_settings_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officer uuid := coalesce(new.officer_id, old.officer_id);
  v_shift uuid;
  v_check uuid;
begin
  for v_shift in
    select id from public.shifts where officer_id = v_officer and status = 'in_progress'
  loop
    for v_check in
      update public.welfare_checks set status = 'cancelled', step_due_at = null
       where shift_id = v_shift and status = 'scheduled'
      returning id
    loop
      perform public.welfare_log(v_check, 'cancelled', now(),
        jsonb_build_object('reason', 'setting_changed', 'by_id', auth.uid()));
    end loop;
    perform public.welfare_schedule_next(v_shift, now());
  end loop;

  perform public.audit('welfare_setting_changed', 'user', v_officer::text, jsonb_build_object(
    'from', case when tg_op = 'INSERT' then 'inherit' else coalesce(old.policy_id::text, old.mode) end,
    'to', case when tg_op = 'DELETE' then 'inherit' else coalesce(new.policy_id::text, new.mode) end));
  return null;
end;
$$;
create trigger officer_welfare_settings_after_write
  after insert or update or delete on public.officer_welfare_settings
  for each row execute function public.officer_welfare_settings_after_write();

revoke execute on function public.officer_welfare_settings_before_write from public, anon, authenticated;
revoke execute on function public.officer_welfare_settings_after_write from public, anon, authenticated;

-- The board, as in phase 17b, with the officer's own setting and where the
-- policy comes from (officer | officer_off | site | site_off | company | none).
drop function public.welfare_board();
create function public.welfare_board()
returns table (
  shift_id uuid,
  officer_id uuid,
  officer_name text,
  officer_phone text,
  site_id uuid,
  site_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  checks_enabled boolean,
  policy_id uuid,
  policy_name text,
  policy_source text,
  open_check_id uuid,
  open_status public.welfare_check_status,
  open_scheduled_at timestamptz,
  open_prompted_at timestamptz,
  open_acknowledged_at timestamptz,
  last_check_id uuid,
  last_status public.welfare_check_status,
  last_scheduled_at timestamptz,
  last_responded_at timestamptz,
  last_response_seconds integer,
  last_response_flags text[],
  answered_count integer,
  missed_count integer,
  heartbeat_at timestamptz,
  battery_level integer,
  app_state text,
  pause_id uuid,
  pause_reason text,
  paused_at timestamptz,
  pause_resume_at timestamptz,
  paused_by_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id, s.officer_id, o.full_name, o.phone, s.site_id, si.name, s.starts_at, s.ends_at,
    coalesce(p.enabled, false), p.id, p.name,
    case
      when ows.mode = 'off' then 'officer_off'
      when ows.mode = 'policy' then 'officer'
      when not si.welfare_checks_enabled then 'site_off'
      when si.welfare_policy_id is not null then 'site'
      when (select st.welfare_policy_id from public.settings st where st.id) is not null then 'company'
      else 'none'
    end,
    oc.id, oc.status, oc.scheduled_at, oc.prompted_at, oc.acknowledged_at,
    lc.id, lc.status, lc.scheduled_at, lc.responded_at, lc.response_seconds, lc.response_flags,
    coalesce(t.answered, 0), coalesce(t.missed, 0),
    hb.last_seen_at, hb.battery_level, hb.app_state,
    wp.id, wp.reason, wp.paused_at, wp.resume_at, wp.paused_by_name
  from public.shifts s
  join public.sites si on si.id = s.site_id
  left join public.profiles o on o.id = s.officer_id
  left join public.officer_welfare_settings ows on ows.officer_id = s.officer_id
  left join public.welfare_check_policies p on p.id = case
    when ows.mode = 'off' then null
    when ows.mode = 'policy' then ows.policy_id
    when si.welfare_checks_enabled
      then coalesce(si.welfare_policy_id, (select st.welfare_policy_id from public.settings st where st.id))
  end
  left join lateral (
    select c.* from public.welfare_checks c
     where c.shift_id = s.id and c.status in ('scheduled', 'prompted', 'alarm', 'calling', 'escalated')
     order by (c.status = 'escalated') desc, c.scheduled_at
     limit 1
  ) oc on true
  left join lateral (
    select c.* from public.welfare_checks c
     where c.shift_id = s.id and c.status in ('responded', 'resolved', 'escalated')
       and c.id is distinct from oc.id
     order by c.scheduled_at desc
     limit 1
  ) lc on true
  left join lateral (
    select count(*) filter (where c.responded_at is not null)::int as answered,
           count(*) filter (where c.status in ('escalated', 'resolved')
                             and (c.responded_at is null or 'after_escalation' = any (c.response_flags)))::int as missed
      from public.welfare_checks c where c.shift_id = s.id
  ) t on true
  left join public.device_heartbeats hb on hb.officer_id = s.officer_id
  left join public.welfare_pauses wp on wp.shift_id = s.id and wp.resumed_at is null
  where s.status = 'in_progress'
    and public.is_active_user()
    and (public.auth_role() = 'admin'
         or (public.auth_role() = 'supervisor' and public.supervises_site(s.site_id)))
  order by o.full_name nulls last, s.starts_at
$$;
revoke execute on function public.welfare_board from public, anon;
grant execute on function public.welfare_board to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quiz allowance
-- ---------------------------------------------------------------------------

create or replace function public.effective_max_attempts(p_assessment public.assessments, p_officer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (public.is_staff() or p_officer = auth.uid()) then 0
    when p_assessment.max_attempts is null then null
    else p_assessment.max_attempts + coalesce((
      select sum(g.extra_attempts)::integer from public.assessment_attempt_grants g
       where g.assessment_id = p_assessment.id and g.officer_id = p_officer), 0)
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. Upload verification
-- ---------------------------------------------------------------------------

-- No more types the server can't check.
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png']
 where id in ('dar-photos', 'chat-attachments');
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
 where id = 'licenses';

drop policy "uploads: file type by bucket and rate limit" on storage.objects;
create policy "uploads: file type by bucket and rate limit"
  on storage.objects as restrictive for insert to authenticated
  with check (
    public.storage_upload_allowed(bucket_id)
    and case bucket_id
      when 'incident-photos' then lower(name) ~ '\.jpe?g$'
      when 'dar-photos' then lower(name) ~ '\.(jpe?g|png)$'
      when 'chat-attachments' then lower(name) ~ '\.(jpe?g|png)$'
      when 'licenses' then lower(name) ~ '\.(jpe?g|png|pdf)$'
      when 'form-submissions' then lower(name) ~ '\.(png|pdf)$'
      when 'form-templates' then name ~ '/(original\.pdf|page-[0-9]+\.png)$'
      when 'lesson-files' then name ~ '/(original\.pdf|page-[0-9]+\.png)$'
      else false
    end
  );

create table public.upload_checks (
  bucket_id text not null,
  name text not null,
  status text not null default 'pending' check (status in ('pending', 'clean', 'rejected')),
  reason text check (char_length(reason) <= 500),
  owner_id text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  checked_at timestamptz,
  primary key (bucket_id, name)
);
comment on table public.upload_checks is
  'Content verification of every Storage upload (verify-upload Edge Function). Server only.';
create index upload_checks_pending_idx on public.upload_checks (created_at) where status = 'pending';

alter table public.upload_checks enable row level security;
create policy "upload_checks: no API access" on public.upload_checks
  for all to authenticated using (false) with check (false);
grant all on public.upload_checks to service_role;

/** Queues a new or replaced file for checking (server uploads are trusted). */
create function public.storage_objects_queue_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if tg_op = 'DELETE' then
    delete from public.upload_checks where bucket_id = old.bucket_id and name = old.name;
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.bucket_id = old.bucket_id and new.name = old.name
       and new.version is not distinct from old.version then
      return null; -- metadata only, same content
    end if;
    delete from public.upload_checks where bucket_id = old.bucket_id and name = old.name;
  end if;

  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception when others then
    v_role := null;
  end;

  if v_role = 'service_role' then
    insert into public.upload_checks (bucket_id, name, status, reason, owner_id, checked_at)
    values (new.bucket_id, new.name, 'clean', 'uploaded by the server', new.owner_id, now())
    on conflict (bucket_id, name) do update
      set status = 'clean', reason = excluded.reason, owner_id = excluded.owner_id,
          attempts = 0, claimed_at = null, checked_at = now();
  else
    insert into public.upload_checks (bucket_id, name, status, owner_id)
    values (new.bucket_id, new.name, 'pending', new.owner_id)
    on conflict (bucket_id, name) do update
      set status = 'pending', reason = null, owner_id = excluded.owner_id,
          attempts = 0, claimed_at = null, checked_at = null, created_at = now();
    perform public.call_edge_function('verify-upload',
      jsonb_build_object('bucket_id', new.bucket_id, 'name', new.name));
  end if;
  return null;
end;
$$;
create trigger upload_checks_queue
  after insert or update or delete on storage.objects
  for each row execute function public.storage_objects_queue_check();
revoke execute on function public.storage_objects_queue_check from public, anon, authenticated;

/** Whether a file passed its content check. */
create function public.upload_is_clean(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user()
     and exists (select 1 from public.upload_checks c
                  where c.bucket_id = p_bucket and c.name = p_name and c.status = 'clean')
$$;
revoke execute on function public.upload_is_clean from public, anon;
grant execute on function public.upload_is_clean to authenticated;

-- Restrictive: on top of every bucket's read policy. Unchecked or rejected
-- files can only be read by the person who uploaded them.
create policy "files: only verified files are readable by others"
  on storage.objects as restrictive for select to authenticated
  using (owner_id = (select auth.uid())::text or public.upload_is_clean(bucket_id, name));

/** verify-upload (service role): files waiting for a check, oldest first. */
create function public.claim_upload_checks(p_limit integer default 50)
returns setof public.upload_checks
language sql
security definer
set search_path = ''
as $$
  update public.upload_checks c
     set claimed_at = now(), attempts = c.attempts + 1
   where (c.bucket_id, c.name) in (
     select x.bucket_id, x.name from public.upload_checks x
      where x.status = 'pending' and x.attempts < 5
        and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
      order by x.created_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked
   )
  returning c.*
$$;

/** verify-upload (service role): the result. A rejected file is audited (the function then deletes it). */
create function public.finish_upload_check(p_bucket text, p_name text, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.upload_checks;
begin
  if p_status not in ('clean', 'rejected', 'pending') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  update public.upload_checks
     set status = p_status, reason = left(p_reason, 500), checked_at = now(), claimed_at = null
   where bucket_id = p_bucket and name = p_name
  returning * into v_row;
  if v_row.bucket_id is not null and p_status = 'rejected' then
    perform public.audit('upload_rejected', 'file', p_bucket || '/' || p_name,
      jsonb_build_object('reason', left(p_reason, 500), 'owner_id', v_row.owner_id),
      case when v_row.owner_id ~ '^[0-9a-f-]{36}$' then v_row.owner_id::uuid end);
  end if;
end;
$$;
revoke execute on function public.claim_upload_checks from public, anon, authenticated;
revoke execute on function public.finish_upload_check from public, anon, authenticated;
grant execute on function public.claim_upload_checks to service_role;
grant execute on function public.finish_upload_check to service_role;

/** pg_cron: retry checks that are still waiting (e.g. the function was down). */
create function public.request_upload_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.upload_checks
              where status = 'pending' and attempts < 5 and created_at < now() - interval '1 minute') then
    perform public.call_edge_function('verify-upload', jsonb_build_object('action', 'sweep'));
  end if;
end;
$$;
revoke execute on function public.request_upload_sweep from public, anon, authenticated;
select cron.schedule('verify-uploads', '*/2 * * * *', 'select public.request_upload_sweep()');

-- Files already stored: check them too (they stay readable only to their
-- uploader until checked; the sweep picks them up).
insert into public.upload_checks (bucket_id, name, status, owner_id, created_at)
select o.bucket_id, o.name, 'pending', o.owner_id, now() - interval '5 minutes'
  from storage.objects o
on conflict do nothing;

-- Audit actions added by this phase.
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'login', 'mfa_verified', 'user_invited', 'role_changed', 'user_suspended', 'user_terminated',
  'user_reactivated', 'device_registered', 'device_reset', 'device_deleted', 'timesheet_corrected',
  'pay_period_locked', 'form_approved', 'form_returned', 'payroll_export', 'bulk_download',
  'report_export', 'welfare_paused', 'welfare_resumed', 'welfare_setting_changed', 'upload_rejected'
));
