-- Phase 2: officer records, clients and sites.
--
-- officer_details   HR details per user (one row per profile)
-- qualifications    licenses and certificates, with scans in the private
--                   `licenses` storage bucket
-- clients           companies Deltacon guards for
-- sites             places officers work, with GPS + clock-in radius
-- site_assignments  which officers work at which sites
--
-- Access summary (every policy also requires is_active_user()):
--   admin       full access to everything
--   supervisor  reads everything; may edit (update) sites
--   officer     reads only their own details, their own qualifications and
--               license scans, their own assignments, and the sites they
--               are assigned to. No access to clients.

-- ---------------------------------------------------------------------------
-- Shared trigger: block non-admin changes to columns that define a row's
-- identity or ownership. Each table passes its protected column names as
-- trigger arguments.
-- ---------------------------------------------------------------------------

create function public.guard_admin_only_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
begin
  if current_user in ('anon', 'authenticated')
     and public.auth_role() is distinct from 'admin'
  then
    foreach col in array tg_argv loop
      if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
        raise exception 'Only admins can change %.%', tg_table_name, col
          using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- officer_details
-- ---------------------------------------------------------------------------

create table public.officer_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  employee_number text unique check (char_length(btrim(employee_number)) between 1 and 50),
  address text check (char_length(address) <= 500),
  -- {"name": "...", "relationship": "...", "phone": "+234..."}; shape is
  -- validated by officerDetailsSchema in packages/shared.
  emergency_contact jsonb check (emergency_contact is null or jsonb_typeof(emergency_contact) = 'object'),
  date_hired date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.officer_details is 'HR details per user. Only admins write; supervisors read all; users read their own.';

create trigger officer_details_set_updated_at
  before update on public.officer_details
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- qualifications
-- ---------------------------------------------------------------------------

create table public.qualifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (char_length(btrim(type)) between 1 and 100),
  license_number text check (char_length(license_number) <= 100),
  issued_on date,
  expires_on date,
  -- Object path inside the `licenses` bucket. Must sit in the owner's
  -- folder ("<user_id>/<file>") so the storage policies line up with it.
  document_path text check (
    document_path is null
    or (char_length(document_path) <= 500 and split_part(document_path, '/', 1) = user_id::text)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

comment on table public.qualifications is 'Licenses and certificates. Scans live in storage bucket "licenses" under <user_id>/.';

create index qualifications_user_id_idx on public.qualifications (user_id);
-- For "licenses expiring soon" alerts.
create index qualifications_expires_on_idx on public.qualifications (expires_on) where expires_on is not null;

create trigger qualifications_set_updated_at
  before update on public.qualifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  contact_person text check (char_length(contact_person) <= 200),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes text check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  -- restrict: deactivate a site instead of losing it with its client.
  client_id uuid not null references public.clients (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  address text check (char_length(address) <= 500),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  clock_in_radius_m integer not null default 150 check (clock_in_radius_m between 25 and 5000),
  emergency_instructions text check (char_length(emergency_instructions) <= 10000),
  -- [{"name": "...", "role": "...", "phone": "+234...", "email": "..."}]
  site_contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(site_contacts) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Coordinates come as a pair or not at all.
  check ((latitude is null) = (longitude is null))
);

create index sites_client_id_idx on public.sites (client_id);

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

-- Supervisors may edit a site's details, but not move it to another client.
create trigger sites_guard_admin_only_columns
  before update on public.sites
  for each row execute function public.guard_admin_only_columns('id', 'client_id', 'created_at');

-- ---------------------------------------------------------------------------
-- site_assignments
-- ---------------------------------------------------------------------------

create table public.site_assignments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  officer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (site_id, officer_id)
);

create index site_assignments_officer_id_idx on public.site_assignments (officer_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.officer_details enable row level security;
alter table public.qualifications enable row level security;
alter table public.clients enable row level security;
alter table public.sites enable row level security;
alter table public.site_assignments enable row level security;

revoke all on public.officer_details, public.qualifications, public.clients,
              public.sites, public.site_assignments
  from anon, authenticated;
grant select, insert, update, delete on public.officer_details, public.qualifications,
              public.clients, public.sites, public.site_assignments
  to authenticated;
grant all on public.officer_details, public.qualifications, public.clients,
             public.sites, public.site_assignments
  to service_role;

-- officer_details ---------------------------------------------------------

create policy "officer_details: users read their own"
  on public.officer_details for select to authenticated
  using ((select public.is_active_user()) and user_id = (select auth.uid()));

create policy "officer_details: staff read all"
  on public.officer_details for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "officer_details: admins insert"
  on public.officer_details for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "officer_details: admins update"
  on public.officer_details for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "officer_details: admins delete"
  on public.officer_details for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- qualifications ----------------------------------------------------------

create policy "qualifications: users read their own"
  on public.qualifications for select to authenticated
  using ((select public.is_active_user()) and user_id = (select auth.uid()));

create policy "qualifications: staff read all"
  on public.qualifications for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "qualifications: admins insert"
  on public.qualifications for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "qualifications: admins update"
  on public.qualifications for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "qualifications: admins delete"
  on public.qualifications for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- clients (officers: no access) ------------------------------------------

create policy "clients: staff read all"
  on public.clients for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "clients: admins insert"
  on public.clients for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "clients: admins update"
  on public.clients for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "clients: admins delete"
  on public.clients for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- sites -------------------------------------------------------------------

create policy "sites: officers read assigned sites"
  on public.sites for select to authenticated
  using (
    (select public.is_active_user())
    and exists (
      select 1 from public.site_assignments sa
       where sa.site_id = sites.id
         and sa.officer_id = (select auth.uid())
    )
  );

create policy "sites: staff read all"
  on public.sites for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "sites: admins insert"
  on public.sites for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "sites: staff update"
  on public.sites for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'))
  with check ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "sites: admins delete"
  on public.sites for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- site_assignments --------------------------------------------------------

create policy "site_assignments: officers read their own"
  on public.site_assignments for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "site_assignments: staff read all"
  on public.site_assignments for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "site_assignments: admins insert"
  on public.site_assignments for insert to authenticated
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "site_assignments: admins update"
  on public.site_assignments for update to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "site_assignments: admins delete"
  on public.site_assignments for delete to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Storage: private `licenses` bucket for license scans
-- Path convention: <user_id>/<random name>.<ext>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'licenses',
  'licenses',
  false,
  10 * 1024 * 1024, -- 10 MB
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
);

create policy "licenses: users read their own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'licenses'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "licenses: staff read all files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'licenses'
    and (select public.is_active_user())
    and (select public.auth_role()) in ('admin', 'supervisor')
  );

create policy "licenses: admins upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'licenses'
    and (select public.is_active_user())
    and (select public.auth_role()) = 'admin'
  );

create policy "licenses: admins update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'licenses'
    and (select public.is_active_user())
    and (select public.auth_role()) = 'admin'
  )
  with check (
    bucket_id = 'licenses'
    and (select public.is_active_user())
    and (select public.auth_role()) = 'admin'
  );

create policy "licenses: admins delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'licenses'
    and (select public.is_active_user())
    and (select public.auth_role()) = 'admin'
  );
