-- Phase 20: device integrity (App Attest / Play Integrity) and device signals.
--
-- The Edge Function device-integrity checks a phone with Apple App Attest
-- (iOS) or Google Play Integrity (Android) against a one-time challenge, and
-- records the verdict on the officer's registered device with
-- record_device_integrity() (service role only):
--   verified     genuine DeltaGuard build from our store listing, genuine device
--   failed       the check ran and failed (modified app, rooted / emulated
--                device, replayed challenge...)
--   unavailable  the check couldn't run (service not configured, unsupported
--                device, Google / Apple unreachable): not counted against anyone
-- The phone also reports signals: rooted / jailbroken, emulator, mock location.
-- Signals and failures are FLAGGED to the officer's supervisors and admins
-- (notification, once per device per day), never silently blocked.
--
-- Sensitive actions check the officer's registered device
-- (device_integrity_for()):
--   clock-in / clock-out (attendance_events), quiz submission
--   (assessment_attempts), form submission (form_submissions -> submitted).
-- settings.integrity_enforcement:
--   'monitor' (default)  record it: attendance flag device_unverified /
--                        device_failed; device_integrity on attempts and forms
--   'block'              refuse actions from FAILED devices (SQLSTATE DG020);
--                        unverified / unavailable are still only flagged, so
--                        a misconfigured service never locks officers out.

-- ---------------------------------------------------------------------------
-- Columns and settings
-- ---------------------------------------------------------------------------

alter table public.user_devices
  add column integrity_status text not null default 'unknown'
    check (integrity_status in ('unknown', 'verified', 'failed', 'unavailable')),
  add column integrity_checked_at timestamptz,
  add column integrity_reasons text[] not null default '{}',
  -- Self-reported by the phone: rooted, emulator, mock_location.
  add column integrity_signals text[] not null default '{}'
    check (integrity_signals <@ array['rooted', 'emulator', 'mock_location']),
  -- iOS App Attest key for this installation (assertions are checked with it).
  add column attest_key_id text check (char_length(attest_key_id) <= 200),
  add column attest_public_key jsonb,
  add column attest_counter bigint not null default 0;

comment on column public.user_devices.integrity_status is
  'Latest App Attest / Play Integrity verdict (device-integrity Edge Function). Server only.';

-- Officers can't write any integrity column (only the service role does).
create or replace function public.user_devices_guard_protected_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and public.auth_role() is distinct from 'admin'
     and (new.user_id is distinct from old.user_id
          or new.device_id is distinct from old.device_id
          or new.platform is distinct from old.platform
          or new.registered_at is distinct from old.registered_at
          or new.revoked_at is distinct from old.revoked_at)
  then
    raise exception 'Only admins can change or revoke a registered device'
      using errcode = '42501';
  end if;
  if current_user in ('anon', 'authenticated')
     and (new.integrity_status is distinct from old.integrity_status
          or new.integrity_checked_at is distinct from old.integrity_checked_at
          or new.integrity_reasons is distinct from old.integrity_reasons
          or new.integrity_signals is distinct from old.integrity_signals
          or new.attest_key_id is distinct from old.attest_key_id
          or new.attest_public_key is distinct from old.attest_public_key
          or new.attest_counter is distinct from old.attest_counter)
  then
    raise exception 'Device integrity is recorded by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- New registrations start unchecked, whatever the phone sends.
create or replace function public.user_devices_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if public.auth_role() is distinct from 'admin' then
      new.registered_at := now();
      new.last_seen_at := now();
      new.revoked_at := null;
    end if;
    new.integrity_status := 'unknown';
    new.integrity_checked_at := null;
    new.integrity_reasons := '{}';
    new.integrity_signals := '{}';
    new.attest_key_id := null;
    new.attest_public_key := null;
    new.attest_counter := 0;
  end if;
  return new;
end;
$$;

alter table public.settings
  add column integrity_enforcement text not null default 'monitor'
    check (integrity_enforcement in ('monitor', 'block'));
comment on column public.settings.integrity_enforcement is
  'monitor: flag actions from unverified / failed phones. block: refuse them from failed phones (DG020).';

alter table public.assessment_attempts add column device_integrity text
  check (device_integrity in ('verified', 'unverified', 'failed'));
alter table public.form_submissions add column device_integrity text
  check (device_integrity in ('verified', 'unverified', 'failed'));

-- Attendance flags gain device_unverified / device_failed.
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.attendance_events'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%wrong_device%';
  execute format('alter table public.attendance_events drop constraint %I', v_name);
end;
$$;
alter table public.attendance_events add constraint attendance_events_flags_check check (
  flags <@ array['late', 'early_leave', 'out_of_range', 'mock_location', 'low_accuracy', 'wrong_device',
                 'device_unverified', 'device_failed']
);

-- ---------------------------------------------------------------------------
-- Challenges
-- ---------------------------------------------------------------------------

create table public.device_integrity_challenges (
  challenge text primary key check (char_length(challenge) between 32 and 128),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at timestamptz
);
comment on table public.device_integrity_challenges is
  'One-time challenges for the device-integrity Edge Function (5 minutes, single use). Server only.';
create index device_integrity_challenges_user_idx on public.device_integrity_challenges (user_id, created_at desc);

alter table public.device_integrity_challenges enable row level security;
create policy "device_integrity_challenges: no API access" on public.device_integrity_challenges
  for all to authenticated using (false) with check (false);
grant all on public.device_integrity_challenges to service_role;

-- ---------------------------------------------------------------------------
-- Recording a verdict (Edge Function, service role)
-- ---------------------------------------------------------------------------

/**
 * Records a verdict and the phone's signals on the officer's active device.
 * A failure or a new signal notifies the officer's supervisors (sharing a
 * site) and all admins, once per device per day per kind.
 */
create function public.record_device_integrity(
  p_user_id uuid,
  p_device_id text,
  p_status text,
  p_reasons text[],
  p_signals text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.user_devices;
  v_name text;
  v_staff uuid[];
  v_new_signals text[];
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_signals text[] := array(select distinct s from unnest(coalesce(p_signals, '{}')) s
                             where s in ('rooted', 'emulator', 'mock_location'));
begin
  if p_status not in ('verified', 'failed', 'unavailable') then
    raise exception 'Unknown integrity status' using errcode = '22023';
  end if;
  select * into v_device from public.user_devices
   where user_id = p_user_id and device_id = p_device_id and revoked_at is null
   for update;
  if v_device.id is null then
    raise exception 'Not the registered device' using errcode = '42501';
  end if;

  v_new_signals := array(select s from unnest(v_signals) s where not s = any (v_device.integrity_signals));
  update public.user_devices
     set integrity_status = p_status,
         integrity_checked_at = now(),
         integrity_reasons = v_reasons[1:20],
         -- Signals stay until the next report without them.
         integrity_signals = v_signals
   where id = v_device.id;

  if p_status = 'failed' or cardinality(v_new_signals) > 0 then
    select coalesce(nullif(btrim(full_name), ''), 'An officer') into v_name
      from public.profiles where id = p_user_id;
    v_staff := array(
      select p.id from public.profiles p
       where p.employment_status = 'active'
         and (p.role = 'admin'
              or (p.role = 'supervisor' and exists (
                    select 1 from public.site_assignments mine
                      join public.site_assignments theirs on theirs.site_id = mine.site_id
                     where mine.officer_id = p.id and theirs.officer_id = p_user_id))));
    perform public.notify_users(
      v_staff, 'device_integrity',
      'Phone security warning: ' || v_name,
      concat_ws(' · ',
        case when p_status = 'failed' then 'Failed the app integrity check' end,
        case when 'rooted' = any (v_signals) then 'Rooted / jailbroken phone' end,
        case when 'emulator' = any (v_signals) then 'Running on an emulator' end,
        case when 'mock_location' = any (v_signals) then 'Fake-location app in use' end),
      jsonb_build_object('officer_id', p_user_id, 'reasons', to_jsonb(v_reasons[1:5]),
                         'signals', to_jsonb(v_signals)),
      'integrity:' || v_device.id || ':' || (now() at time zone 'utc')::date || ':' ||
        case when p_status = 'failed' then 'failed' else array_to_string(v_new_signals, ',') end
    );
  end if;
end;
$$;
revoke execute on function public.record_device_integrity from public, anon, authenticated;
grant execute on function public.record_device_integrity to service_role;

/** Service role: stores the App Attest key after a verified attestation / assertion. */
create function public.save_attest_key(
  p_user_id uuid,
  p_device_id text,
  p_key_id text,
  p_public_key jsonb,
  p_counter bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_devices
     set attest_key_id = p_key_id, attest_public_key = p_public_key, attest_counter = p_counter
   where user_id = p_user_id and device_id = p_device_id and revoked_at is null
$$;
revoke execute on function public.save_attest_key from public, anon, authenticated;
grant execute on function public.save_attest_key to service_role;

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------

/**
 * The officer's registered phone, as sensitive actions see it:
 *   verified    checked in the last 24 hours, passed, no signals
 *   failed      failed the check, or reports root / emulator / mock location
 *   unverified  never checked, too old, or the check couldn't run
 */
create function public.device_integrity_for(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when d.integrity_status = 'failed' or cardinality(d.integrity_signals) > 0 then 'failed'
      when d.integrity_status = 'verified' and d.integrity_checked_at > now() - interval '24 hours'
        then 'verified'
      else 'unverified'
    end
      from public.user_devices d
     where d.user_id = p_user_id and d.revoked_at is null
     order by d.registered_at desc
     limit 1
  ), 'unverified')
$$;
revoke execute on function public.device_integrity_for from public, anon, authenticated;

/** Refuses (block mode, failed phone) or returns the verdict to record. */
create function public.device_integrity_gate(p_user_id uuid, p_action text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text := public.device_integrity_for(p_user_id);
begin
  if v_state = 'failed'
     and coalesce((select integrity_enforcement from public.settings where id), 'monitor') = 'block' then
    raise exception 'This phone failed DeltaGuard''s security check, so you can''t % from it. Contact your supervisor.', p_action
      using errcode = 'DG020';
  end if;
  return v_state;
end;
$$;
revoke execute on function public.device_integrity_gate from public, anon, authenticated;

create function public.attendance_events_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  -- Refused attempts (wrong phone) are stored as evidence, never blocked here.
  if not new.accepted then
    return new;
  end if;
  v_state := public.device_integrity_gate(new.officer_id, 'clock in or out');
  if v_state <> 'verified' then
    new.flags := array_append(new.flags,
      case v_state when 'failed' then 'device_failed' else 'device_unverified' end);
  end if;
  return new;
end;
$$;
create trigger attendance_events_integrity
  before insert on public.attendance_events
  for each row execute function public.attendance_events_integrity();

create function public.assessment_attempts_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.submitted_at is null and new.submitted_at is not null then
    new.device_integrity := public.device_integrity_gate(new.officer_id, 'submit a quiz');
  end if;
  return new;
end;
$$;
create trigger assessment_attempts_integrity
  before update of submitted_at on public.assessment_attempts
  for each row execute function public.assessment_attempts_integrity();

create function public.form_submissions_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = 'submitted' and old.status::text is distinct from 'submitted' then
    new.device_integrity := public.device_integrity_gate(new.officer_id, 'sign and submit a form');
  end if;
  return new;
end;
$$;
create trigger form_submissions_integrity
  before update of status on public.form_submissions
  for each row execute function public.form_submissions_integrity();

revoke execute on function public.attendance_events_integrity from public, anon, authenticated;
revoke execute on function public.assessment_attempts_integrity from public, anon, authenticated;
revoke execute on function public.form_submissions_integrity from public, anon, authenticated;

-- device_integrity on attempts and submissions is written by the triggers
-- above only: whatever an officer's client sends is ignored.
create function public.guard_device_integrity_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and public.auth_role() is distinct from 'admin' then
    new.device_integrity := case when tg_op = 'UPDATE' then old.device_integrity end;
  end if;
  return new;
end;
$$;
-- Named to run before the *_integrity triggers (alphabetical order).
create trigger form_submissions_a_guard_integrity
  before insert or update on public.form_submissions
  for each row execute function public.guard_device_integrity_column();
create trigger assessment_attempts_a_guard_integrity
  before insert or update on public.assessment_attempts
  for each row execute function public.guard_device_integrity_column();
revoke execute on function public.guard_device_integrity_column from public, anon, authenticated;
