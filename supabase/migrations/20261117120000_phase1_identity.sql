-- Phase 1: identity foundation.
--
-- profiles      one row per auth user: name, phone, role, employment status
-- user_devices  the phones officers sign in from (one active device per user)
--
-- Where roles live:
--   public.profiles.role / employment_status are what admins edit.
--   A trigger copies them into auth.users.raw_app_meta_data (app_metadata).
--   The custom access token hook copies app_metadata into the JWT as the
--   `user_role` and `employment_status` claims.
--   RLS policies read those claims through auth_role() and is_active_user().
-- Never set the role in user_metadata: users can edit their own user_metadata.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin', 'supervisor', 'officer');
create type public.employment_status as enum ('active', 'suspended', 'terminated');
create type public.device_platform as enum ('ios', 'android');

-- ---------------------------------------------------------------------------
-- JWT helper functions (used by every RLS policy)
-- ---------------------------------------------------------------------------

-- The caller's role from the `user_role` JWT claim, or NULL if absent/invalid.
-- (Not `role`: Supabase already uses that claim for the Postgres role,
-- `authenticated`, and overwriting it would break every request.)
create function public.auth_role()
returns public.user_role
language sql
stable
set search_path = ''
as $$
  select r
  from unnest(enum_range(null::public.user_role)) as r
  where r::text = auth.jwt() ->> 'user_role'
$$;

-- True only when the JWT says the caller is currently employed. A missing
-- claim counts as inactive, so the default is "no access".
create function public.is_active_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'employment_status' = 'active', false)
$$;

comment on function public.auth_role() is 'Role from the user_role JWT claim (set by custom_access_token_hook).';
comment on function public.is_active_user() is 'True when the employment_status JWT claim is active.';

-- ---------------------------------------------------------------------------
-- Custom access token hook
-- Enable in the dashboard: Authentication > Hooks > Customize Access Token.
-- Runs as supabase_auth_admin every time a JWT is issued or refreshed.
-- ---------------------------------------------------------------------------

create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  app_meta jsonb;
  meta_role text;
  meta_status text;
begin
  select u.raw_app_meta_data
    into app_meta
    from auth.users as u
   where u.id = (event ->> 'user_id')::uuid;

  meta_role := app_meta ->> 'role';
  meta_status := app_meta ->> 'employment_status';

  -- Only known values reach the token. Anything else is dropped, which
  -- auth_role() / is_active_user() treat as "no access".
  if meta_role in ('admin', 'supervisor', 'officer') then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(meta_role));
  else
    claims := claims - 'user_role';
  end if;

  if meta_status in ('active', 'suspended', 'terminated') then
    claims := jsonb_set(claims, '{employment_status}', to_jsonb(meta_status));
  else
    claims := claims - 'employment_status';
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(btrim(full_name)) between 1 and 200),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'), -- E.164, e.g. +2348012345678
  role public.user_role not null default 'officer',
  employment_status public.employment_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per user. role and employment_status are mirrored into auth app_metadata.';

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- RLS cannot restrict columns, so this trigger does: only admins (or server
-- code using the service role) may change role, employment status, id or
-- created_at. Officers and supervisors can still edit their name and phone.
create function public.profiles_guard_protected_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and public.auth_role() is distinct from 'admin'
     and (new.role is distinct from old.role
          or new.employment_status is distinct from old.employment_status
          or new.id is distinct from old.id
          or new.created_at is distinct from old.created_at)
  then
    raise exception 'Only admins can change role or employment status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_protected_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_protected_columns();

-- Copy role / employment status into app_metadata so the next JWT carries
-- them. When either changes, the user's sessions are deleted so they cannot
-- refresh into a token with the old role. An access token already issued
-- stays valid until it expires (auth.jwt_expiry, 1 hour by default).
create function public.sync_profile_to_app_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('role', new.role, 'employment_status', new.employment_status)
   where id = new.id;

  if tg_op = 'UPDATE'
     and (new.role is distinct from old.role
          or new.employment_status is distinct from old.employment_status)
  then
    delete from auth.sessions where user_id = new.id;
  end if;

  return null;
end;
$$;

revoke execute on function public.sync_profile_to_app_metadata() from public, anon, authenticated;

create trigger profiles_sync_app_metadata
  after insert or update of role, employment_status on public.profiles
  for each row execute function public.sync_profile_to_app_metadata();

-- Create a profile for every new auth user (invited by an admin). The role
-- comes from app_metadata if an admin set one, else 'officer'. full_name
-- comes from the invite's data payload.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_role text := new.raw_app_meta_data ->> 'role';
  meta_status text := new.raw_app_meta_data ->> 'employment_status';
begin
  insert into public.profiles (id, full_name, role, employment_status)
  values (
    new.id,
    nullif(btrim(left(new.raw_user_meta_data ->> 'full_name', 200)), ''),
    case when meta_role in ('admin', 'supervisor', 'officer')
         then meta_role::public.user_role else 'officer' end,
    case when meta_status in ('active', 'suspended', 'terminated')
         then meta_status::public.employment_status else 'active' end
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- RLS ---------------------------------------------------------------------

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy "profiles: users read their own"
  on public.profiles for select to authenticated
  using ((select public.is_active_user()) and id = (select auth.uid()));

create policy "profiles: supervisors read officers"
  on public.profiles for select to authenticated
  using (
    (select public.is_active_user())
    and (select public.auth_role()) = 'supervisor'
    and role = 'officer'
  );

create policy "profiles: admins read all"
  on public.profiles for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "profiles: users update their own"
  on public.profiles for update to authenticated
  using ((select public.is_active_user()) and id = (select auth.uid()))
  with check ((select public.is_active_user()) and id = (select auth.uid()));

create policy "profiles: admins update all"
  on public.profiles for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "profiles: admins insert"
  on public.profiles for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "profiles: admins delete"
  on public.profiles for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- user_devices
-- ---------------------------------------------------------------------------

create table public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 200),
  platform public.device_platform not null,
  push_token text check (char_length(push_token) <= 500),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= registered_at)
);

comment on table public.user_devices is 'Registered phones. At most one non-revoked device per user.';

-- One active device per user: a partial unique index only counts rows that
-- are not revoked, so old revoked devices stay as history.
create unique index user_devices_one_active_per_user
  on public.user_devices (user_id)
  where revoked_at is null;

create index user_devices_user_id_idx on public.user_devices (user_id);

-- Non-admins may only touch push_token and last_seen_at. In particular an
-- officer cannot revoke their own device to register a second phone, or
-- un-revoke a device an admin revoked.
create function public.user_devices_guard_protected_columns()
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
  return new;
end;
$$;

create trigger user_devices_guard_protected_columns
  before update on public.user_devices
  for each row execute function public.user_devices_guard_protected_columns();

-- RLS ---------------------------------------------------------------------

alter table public.user_devices enable row level security;

revoke all on public.user_devices from anon, authenticated;
grant select, insert, update, delete on public.user_devices to authenticated;
grant all on public.user_devices to service_role;

create policy "user_devices: users read their own"
  on public.user_devices for select to authenticated
  using ((select public.is_active_user()) and user_id = (select auth.uid()));

create policy "user_devices: admins read all"
  on public.user_devices for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "user_devices: users register their own"
  on public.user_devices for insert to authenticated
  with check (
    (select public.is_active_user())
    and user_id = (select auth.uid())
    and revoked_at is null
  );

create policy "user_devices: users update their active device"
  on public.user_devices for update to authenticated
  using ((select public.is_active_user()) and user_id = (select auth.uid()) and revoked_at is null)
  with check ((select public.is_active_user()) and user_id = (select auth.uid()));

create policy "user_devices: admins insert"
  on public.user_devices for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "user_devices: admins update all"
  on public.user_devices for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "user_devices: admins delete"
  on public.user_devices for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');
