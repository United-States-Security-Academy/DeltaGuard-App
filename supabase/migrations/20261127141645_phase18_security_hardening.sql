-- Phase 18: security hardening (audit, 2026-11-27).
--
-- Findings fixed here (tests: supabase/tests/database/phase18_security.test.sql):
--   1. Privileges: tables created by migrations inherited TRUNCATE / REFERENCES /
--      TRIGGER / MAINTAIN for anon and authenticated (TRUNCATE ignores RLS).
--      Revoked on every table, and in postgres's default privileges, so new
--      tables don't get them. anon keeps nothing in public.
--   2. Functions: ~35 older functions (incl. the SECURITY DEFINER auth_role()
--      and is_active_user(), and 8 definer trigger functions) still had
--      Postgres's default EXECUTE for PUBLIC, so anon could call them. Trigger
--      functions: no API role may execute them (firing a trigger needs no
--      EXECUTE). Others: authenticated + service_role only.
--      effective_max_attempts() (another officer's attempt allowance) is now
--      internal.
--   3. Storage: form-templates (50 MB) and lesson-files (100 MB) now 20 MB,
--      PDF + rendered page PNGs only, by path (<id>/<upload>/original.pdf |
--      page-N.png). Every bucket: a restrictive upload policy checks the file
--      extension per bucket and an upload rate limit (non-admins).
--   4. Rate limits (SQLSTATE DG429): new SOS alerts, welfare answers, quiz
--      starts and submissions, uploads, invites, exports.
--   5. Edge Functions called by the database now get a shared secret header
--      (Vault secret deltaguard_cron_secret); the functions refuse requests
--      without it.
--   6. audit_log: append-only (no UPDATE / DELETE / TRUNCATE for anyone, even
--      the service role), written only by triggers and log_audit_event().
--   7. Column guards: notifications.read_at is server time; officers can't
--      backdate a device registration; a chat attachment must be in the
--      message's own conversation/sender folder.
--   8. pg_graphql: not used by the apps; dropped if present.
--   9. push_tickets had RLS with no policy (deny by default): now an explicit
--      deny policy, like the other server-only tables below.

-- ---------------------------------------------------------------------------
-- 1. Table privileges
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger, maintain on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Function privileges
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype) as is_trigger,
           coalesce((select bool_or(a.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.privilege_type = 'EXECUTE'), false) as public_exec
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proowner = 'postgres'::regrole
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if f.is_trigger then
      execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    elsif f.public_exec then
      execute format('revoke execute on function %s from public, anon', f.sig);
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from anon', f.sig);
    end if;
  end loop;
end;
$$;

-- Internal: used only by the quiz functions (which run as the owner).
revoke execute on function public.effective_max_attempts(public.assessments, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 8. GraphQL (the apps use PostgREST only)
-- ---------------------------------------------------------------------------

drop extension if exists pg_graphql;

-- ---------------------------------------------------------------------------
-- 4. Rate limits
-- ---------------------------------------------------------------------------

create table public.rate_limit_counters (
  user_id uuid not null,
  action text not null check (char_length(action) between 1 and 100),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, action, window_start)
);
comment on table public.rate_limit_counters is
  'Fixed-window request counters per user and action. Written only by rate_limit_hit().';
alter table public.rate_limit_counters enable row level security;
create policy "rate_limit_counters: no API access" on public.rate_limit_counters
  for all to authenticated using (false) with check (false);
grant all on public.rate_limit_counters to service_role;

/**
 * Counts one hit for (user, action) in the current fixed window and raises
 * DG429 once p_max hits are used up. No user (service role, cron): no limit.
 */
create function public.rate_limit_hit(p_user uuid, p_action text, p_max integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  if p_user is null then
    return;
  end if;
  delete from public.rate_limit_counters
   where user_id = p_user and action = p_action and window_start < v_start;
  select hits into v_hits from public.rate_limit_counters
   where user_id = p_user and action = p_action and window_start = v_start;
  if coalesce(v_hits, 0) >= p_max then
    raise exception 'Too many requests. Wait a few minutes and try again'
      using errcode = 'DG429', hint = p_action;
  end if;
  insert into public.rate_limit_counters (user_id, action, window_start, hits)
  values (p_user, p_action, v_start, 1)
  on conflict (user_id, action, window_start) do update set hits = public.rate_limit_counters.hits + 1;
end;
$$;
revoke execute on function public.rate_limit_hit from public, anon, authenticated;

/**
 * Server code (console) checks a fixed action before doing it: the limits live
 * here, not in the caller. invite: admins, 30 an hour. export: staff, 60 an hour.
 */
create function public.enforce_rate_limit(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  case p_action
    when 'invite' then
      if public.auth_role() is distinct from 'admin' then
        raise exception 'Not allowed' using errcode = '42501';
      end if;
      perform public.rate_limit_hit(auth.uid(), 'invite', 30, 3600);
    when 'export' then
      if not public.is_staff() then
        raise exception 'Not allowed' using errcode = '42501';
      end if;
      perform public.rate_limit_hit(auth.uid(), 'export', 60, 3600);
    else
      raise exception 'Unknown action' using errcode = '22023';
  end case;
end;
$$;
revoke execute on function public.enforce_rate_limit from public, anon;
grant execute on function public.enforce_rate_limit to authenticated;

/** New SOS alerts: 6 an hour per officer (raise_sos returns an open alert without inserting). */
create function public.sos_alerts_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rate_limit_hit(new.officer_id, 'sos_raise', 6, 3600);
  return new;
end;
$$;
create trigger sos_alerts_rate_limit
  before insert on public.sos_alerts
  for each row execute function public.sos_alerts_rate_limit();

/** Quiz attempts: 20 starts and 10 submissions an hour per officer. */
create function public.assessment_attempts_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.rate_limit_hit(new.officer_id, 'quiz_start', 20, 3600);
  elsif old.submitted_at is null and new.submitted_at is not null then
    perform public.rate_limit_hit(new.officer_id, 'quiz_submit', 10, 3600);
  end if;
  return new;
end;
$$;
create trigger assessment_attempts_rate_limit
  before insert or update of submitted_at on public.assessment_attempts
  for each row execute function public.assessment_attempts_rate_limit();

revoke execute on function public.sos_alerts_rate_limit from public, anon, authenticated;
revoke execute on function public.assessment_attempts_rate_limit from public, anon, authenticated;

-- respond_welfare_check (phase 17) with a rate limit: 30 calls in 5 minutes.
create or replace function public.respond_welfare_check(
  p_check_id uuid,
  p_responded_at_device timestamptz,
  p_biometric_verified boolean,
  p_offline boolean,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_check public.welfare_checks;
  v_at timestamptz := now();
  v_seconds integer;
  v_flags text[] := '{}';
  v_was public.welfare_check_status;
  v_name text;
  v_next record;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform public.rate_limit_hit(v_uid, 'welfare_respond', 30, 300);
  select * into v_check from public.welfare_checks where id = p_check_id for update;
  if v_check.id is null or v_check.officer_id <> v_uid then
    raise exception 'Welfare check not found' using errcode = '42501';
  end if;

  if v_check.responded_at is null and v_check.status not in ('cancelled', 'resolved') then
    if v_check.status = 'scheduled' and v_check.scheduled_at > now() + interval '2 minutes' then
      raise exception 'This welfare check isn''t due yet' using errcode = 'P0001';
    end if;
    if p_device_id is not null and char_length(p_device_id) not between 1 and 200 then
      raise exception 'Invalid device' using errcode = '22023';
    end if;

    if coalesce(p_offline, false) then
      if p_responded_at_device is null then
        raise exception 'An offline answer needs the time it was given' using errcode = '22023';
      end if;
      if p_responded_at_device > now() + interval '5 minutes' then
        raise exception 'The time on this phone is wrong. Set it to automatic and try again'
          using errcode = '22023';
      end if;
      v_at := least(greatest(p_responded_at_device, v_check.scheduled_at), now());
      v_flags := array_append(v_flags, 'offline');
    end if;

    v_seconds := greatest(0, floor(extract(epoch from (
      v_at - least(coalesce(v_check.prompted_at, v_check.scheduled_at), v_at)))))::int;
    if v_seconds > (v_check.policy ->> 'response_seconds')::int then
      v_flags := array_append(v_flags, 'late');
    end if;
    if v_check.status = 'escalated' then
      v_flags := array_append(v_flags, 'after_escalation');
    end if;
    if p_device_id is null or not exists (
      select 1 from public.user_devices d
       where d.user_id = v_uid and d.device_id = p_device_id and d.revoked_at is null
    ) then
      v_flags := array_append(v_flags, 'unregistered_device');
    end if;

    v_was := v_check.status;
    update public.welfare_checks
       set responded_at = v_at,
           responded_at_device = p_responded_at_device,
           response_seconds = v_seconds,
           responded_offline = coalesce(p_offline, false),
           biometric_verified = coalesce(p_biometric_verified, false),
           device_id = p_device_id,
           response_flags = v_flags,
           -- An escalated check stays open until a supervisor closes it.
           status = case when v_was = 'escalated' then 'escalated'::public.welfare_check_status
                         else 'responded' end,
           step_due_at = null
     where id = p_check_id
    returning * into v_check;

    perform public.welfare_log(p_check_id, 'responded', now(), jsonb_build_object(
      'responded_at', v_at, 'response_seconds', v_seconds, 'flags', to_jsonb(v_flags),
      'biometric_verified', coalesce(p_biometric_verified, false), 'previous_status', v_was
    ));

    if v_was = 'escalated' then
      select coalesce(nullif(btrim(full_name), ''), 'The officer') into v_name
        from public.profiles where id = v_uid;
      perform public.notify_users(
        v_check.alerted_user_ids, 'welfare_update', v_name || ' answered the welfare check',
        'Answered at ' || public.welfare_local_time(v_at) || '. Close the alert with a note.',
        jsonb_build_object('check_id', p_check_id), 'welfare:' || p_check_id || ':answered'
      );
    end if;

    perform public.welfare_schedule_next(v_check.shift_id, now());
  end if;

  select n.id, n.scheduled_at into v_next from public.get_next_welfare_check() n;
  return jsonb_build_object(
    'id', v_check.id,
    'status', v_check.status,
    'responded_at', v_check.responded_at,
    'response_seconds', v_check.response_seconds,
    'response_flags', to_jsonb(v_check.response_flags),
    'next_check', case when v_next.id is not null
      then jsonb_build_object('id', v_next.id, 'scheduled_at', v_next.scheduled_at) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Storage
-- ---------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 20971520, allowed_mime_types = array['application/pdf', 'image/png']
 where id in ('form-templates', 'lesson-files');

/** Uploads by non-admins: at most 60 files per bucket in 10 minutes. */
create function public.storage_upload_allowed(p_bucket text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.auth_role() is not distinct from 'admin'
      or (select count(*) from storage.objects o
           where o.bucket_id = p_bucket and o.owner_id = auth.uid()::text
             and o.created_at > now() - interval '10 minutes') < 60
$$;
revoke execute on function public.storage_upload_allowed from public, anon;
grant execute on function public.storage_upload_allowed to authenticated;

-- Restrictive: applies on top of each bucket's own upload policy. A bucket not
-- listed here can't take uploads from the API until it is added.
create policy "uploads: file type by bucket and rate limit"
  on storage.objects as restrictive for insert to authenticated
  with check (
    public.storage_upload_allowed(bucket_id)
    and case bucket_id
      when 'incident-photos' then lower(name) ~ '\.jpe?g$'
      when 'dar-photos' then lower(name) ~ '\.(jpe?g|png|webp|heic)$'
      when 'chat-attachments' then lower(name) ~ '\.(jpe?g|png|webp)$'
      when 'licenses' then lower(name) ~ '\.(jpe?g|png|webp|heic|pdf)$'
      when 'form-submissions' then lower(name) ~ '\.(png|pdf)$'
      when 'form-templates' then name ~ '/(original\.pdf|page-[0-9]+\.png)$'
      when 'lesson-files' then name ~ '/(original\.pdf|page-[0-9]+\.png)$'
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- 5. Edge Functions called by the database send a shared secret
-- ---------------------------------------------------------------------------

/**
 * POSTs to an Edge Function with the x-deltaguard-cron-secret header (Vault
 * secrets deltaguard_functions_url and deltaguard_cron_secret). Without them
 * it does nothing: the functions refuse unauthenticated calls.
 */
create function public.call_edge_function(p_function text, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'deltaguard_functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'deltaguard_cron_secret';
  if v_url is null then
    return;
  end if;
  if v_secret is null then
    raise warning 'call_edge_function(%): Vault secret deltaguard_cron_secret is missing', p_function;
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/' || p_function,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-deltaguard-cron-secret', v_secret),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'call_edge_function(%): %', p_function, sqlerrm;
end;
$$;
revoke execute on function public.call_edge_function from public, anon, authenticated;

create or replace function public.request_push_delivery(p_notification_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.call_edge_function('send-notification', case
    when p_notification_ids is null then jsonb_build_object('action', 'maintenance')
    else jsonb_build_object('notification_ids', to_jsonb(p_notification_ids))
  end)
$$;

create or replace function public.request_sos_sms()
returns void
language sql
security definer
set search_path = ''
as $$
  select public.call_edge_function('sos-dispatch', jsonb_build_object('action', 'send_sms'))
$$;

create or replace function public.request_welfare_delivery()
returns void
language sql
security definer
set search_path = ''
as $$
  select public.call_edge_function('welfare-escalation', jsonb_build_object('action', 'deliver'))
$$;

-- ---------------------------------------------------------------------------
-- 6. Audit log
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,          -- no foreign key: entries outlive the people in them
  actor_role text,
  action text not null check (action in (
    'login', 'mfa_verified', 'user_invited', 'role_changed', 'user_suspended', 'user_terminated',
    'user_reactivated', 'device_registered', 'device_reset', 'device_deleted', 'timesheet_corrected',
    'pay_period_locked', 'form_approved', 'form_returned', 'payroll_export', 'bulk_download',
    'report_export', 'welfare_paused', 'welfare_resumed'
  )),
  target_type text check (char_length(target_type) <= 50),
  target_id text check (char_length(target_id) <= 200),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192),
  ip text,
  user_agent text check (char_length(user_agent) <= 500)
);
comment on table public.audit_log is
  'Append-only security audit trail. Rows can''t be changed or deleted by anyone (triggers), only added by audit functions.';
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id);

create function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

alter table public.audit_log enable row level security;
create policy "audit_log: admins read"
  on public.audit_log for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;
grant usage on sequence public.audit_log_id_seq to service_role;

/** Adds an audit entry as the current user (internal). */
create function public.audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_details jsonb default '{}',
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_headers jsonb;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, details, ip, user_agent)
  values (
    v_actor,
    (select role::text from public.profiles where id = v_actor),
    p_action, p_target_type, p_target_id, coalesce(p_details, '{}'),
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    left(v_headers ->> 'user-agent', 500)
  );
end;
$$;

/**
 * Staff: record something done outside the database (exports, bulk downloads,
 * invites through the Auth admin API). Rate limited with exports.
 */
create function public.log_audit_event(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_details jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_action not in ('payroll_export', 'bulk_download', 'report_export', 'user_invited') then
    raise exception 'Unknown audit action' using errcode = '22023';
  end if;
  if p_action = 'user_invited' and public.auth_role() is distinct from 'admin' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_details is not null and (jsonb_typeof(p_details) <> 'object' or pg_column_size(p_details) > 8192) then
    raise exception 'Details must be a small object' using errcode = '22023';
  end if;
  perform public.rate_limit_hit(auth.uid(), 'audit_event', 120, 3600);
  perform public.audit(p_action, left(p_target_type, 50), left(p_target_id, 200), coalesce(p_details, '{}'));
end;
$$;

-- Logins and MFA step-up (Supabase Auth sessions). Never blocks a sign-in.
create function public.audit_auth_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, details, ip, user_agent)
      values (new.user_id, (select role::text from public.profiles where id = new.user_id), 'login',
              'session', new.id::text, jsonb_build_object('aal', new.aal::text), host(new.ip), left(new.user_agent, 500));
    elsif new.aal::text = 'aal2' and old.aal::text is distinct from 'aal2' then
      insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, ip, user_agent)
      values (new.user_id, (select role::text from public.profiles where id = new.user_id), 'mfa_verified',
              'session', new.id::text, host(new.ip), left(new.user_agent, 500));
    end if;
  exception when others then
    raise warning 'audit_auth_session: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger audit_sessions
  after insert or update of aal on auth.sessions
  for each row execute function public.audit_auth_session();

create function public.audit_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    perform public.audit('role_changed', 'user', new.id::text,
      jsonb_build_object('from', old.role, 'to', new.role, 'name', new.full_name));
  end if;
  if new.employment_status is distinct from old.employment_status then
    perform public.audit(
      case new.employment_status when 'terminated' then 'user_terminated'
                                 when 'suspended' then 'user_suspended'
                                 else 'user_reactivated' end,
      'user', new.id::text,
      jsonb_build_object('from', old.employment_status, 'to', new.employment_status, 'name', new.full_name));
  end if;
  return null;
end;
$$;
create trigger audit_profiles
  after update of role, employment_status on public.profiles
  for each row execute function public.audit_profiles();

create function public.audit_user_devices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('device_registered', 'user', new.user_id::text,
      jsonb_build_object('device_id', new.device_id, 'platform', new.platform));
  elsif tg_op = 'UPDATE' then
    if old.revoked_at is null and new.revoked_at is not null then
      perform public.audit('device_reset', 'user', new.user_id::text,
        jsonb_build_object('device_id', new.device_id, 'platform', new.platform));
    end if;
  else
    perform public.audit('device_deleted', 'user', old.user_id::text,
      jsonb_build_object('device_id', old.device_id, 'platform', old.platform));
  end if;
  return null;
end;
$$;
create trigger audit_user_devices
  after insert or update of revoked_at or delete on public.user_devices
  for each row execute function public.audit_user_devices();

create function public.audit_timesheet_corrections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.audit('timesheet_corrected', 'timesheet_entry', new.entry_id::text,
    jsonb_build_object('previous_clock_in_at', new.previous_clock_in_at,
                       'previous_clock_out_at', new.previous_clock_out_at,
                       'new_clock_in_at', new.new_clock_in_at,
                       'new_clock_out_at', new.new_clock_out_at,
                       'reason', new.reason),
    new.corrected_by);
  return null;
end;
$$;
create trigger audit_timesheet_corrections
  after insert on public.timesheet_corrections
  for each row execute function public.audit_timesheet_corrections();

create function public.audit_pay_periods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = 'locked' and old.status::text is distinct from 'locked' then
    perform public.audit('pay_period_locked', 'pay_period', new.id::text,
      jsonb_build_object('starts_on', new.starts_on, 'ends_on', new.ends_on), new.locked_by);
  end if;
  return null;
end;
$$;
create trigger audit_pay_periods
  after update of status on public.pay_periods
  for each row execute function public.audit_pay_periods();

create function public.audit_form_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text in ('approved', 'returned') and new.status is distinct from old.status then
    perform public.audit(case new.status::text when 'approved' then 'form_approved' else 'form_returned' end,
      'form_submission', new.id::text,
      jsonb_build_object('officer_id', new.officer_id, 'template_id', new.template_id,
                         'notes', left(new.review_notes, 500)),
      new.reviewer_id);
  end if;
  return null;
end;
$$;
create trigger audit_form_reviews
  after update of status on public.form_submissions
  for each row execute function public.audit_form_reviews();

create function public.audit_welfare_pauses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('welfare_paused', 'shift', new.shift_id::text,
      jsonb_build_object('officer_id', new.officer_id, 'reason', new.reason, 'resume_at', new.resume_at),
      new.paused_by);
  elsif old.resumed_at is null and new.resumed_at is not null then
    perform public.audit('welfare_resumed', 'shift', new.shift_id::text,
      jsonb_build_object('officer_id', new.officer_id, 'how', new.resume_reason), new.resumed_by);
  end if;
  return null;
end;
$$;
create trigger audit_welfare_pauses
  after insert or update of resumed_at on public.welfare_pauses
  for each row execute function public.audit_welfare_pauses();

revoke execute on function public.audit from public, anon, authenticated;
revoke execute on function public.audit_log_append_only from public, anon, authenticated;
revoke execute on function public.audit_auth_session from public, anon, authenticated;
revoke execute on function public.audit_profiles from public, anon, authenticated;
revoke execute on function public.audit_user_devices from public, anon, authenticated;
revoke execute on function public.audit_timesheet_corrections from public, anon, authenticated;
revoke execute on function public.audit_pay_periods from public, anon, authenticated;
revoke execute on function public.audit_form_reviews from public, anon, authenticated;
revoke execute on function public.audit_welfare_pauses from public, anon, authenticated;
revoke execute on function public.log_audit_event from public, anon;
grant execute on function public.log_audit_event to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Column guards
-- ---------------------------------------------------------------------------

-- notifications: only read_at, and it is the server's time (no backdating).
create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
      raise exception 'Only read_at can be changed' using errcode = '42501';
    end if;
    new.read_at := case when new.read_at is null then null
                        when old.read_at is not null then old.read_at
                        else now() end;
  end if;
  return new;
end;
$$;

-- user_devices: registration times are the server's, and a device registers active.
create function public.user_devices_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and public.auth_role() is distinct from 'admin' then
    new.registered_at := now();
    new.last_seen_at := now();
    new.revoked_at := null;
  end if;
  return new;
end;
$$;
create trigger user_devices_before_insert
  before insert on public.user_devices
  for each row execute function public.user_devices_before_insert();
revoke execute on function public.user_devices_before_insert from public, anon, authenticated;

-- messages: an attachment must sit in this conversation's folder for this sender.
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  if new.attachment_path is not null then
    if split_part(new.attachment_path, '/', 1) <> new.conversation_id::text
       or split_part(new.attachment_path, '/', 2) <> new.sender_id::text
       or split_part(new.attachment_path, '/', 3) = ''
       or split_part(new.attachment_path, '/', 4) <> '' then
      raise exception 'Invalid attachment' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'chat-attachments' and o.name = new.attachment_path
    ) then
      raise exception 'The photo hasn''t finished uploading' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Explicit deny for server-only tables
-- ---------------------------------------------------------------------------

create policy "push_tickets: no API access" on public.push_tickets
  for all to authenticated using (false) with check (false);
