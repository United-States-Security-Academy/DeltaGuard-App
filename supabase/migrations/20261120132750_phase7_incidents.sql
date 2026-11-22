-- Phase 7: incident reports with photos, supervisor review and an audit log.
--
-- incidents                  one row per report; written only by
--                            submit_incident() (officer) and review_incident()
--                            (admin/supervisor), so the rules live in one place
-- incident_photos            photos of a report (private `incident-photos` bucket)
-- incident_status_history    audit log: every status change, who, when, notes.
--                            Written only by trigger.
--
-- Lifecycle:
--   (phone draft) --submit--> submitted --review--> under_review
--   submitted / under_review --review--> approved | returned (notes required)
--   returned --officer edits and resubmits--> submitted
--   approved is final. Officers can change a report only while it is returned.
--
-- Offline-friendly submit: the phone picks the report id (a UUID) and the
-- photo paths when the report is created, uploads the photos first, then calls
-- submit_incident(). Every step can be retried safely:
--   * a photo upload that already happened fails with "already exists", which
--     the phone treats as done;
--   * submit_incident() with an id that is already submitted returns the
--     existing report unchanged (the earlier call got through but its reply
--     was lost).
-- The report row and its photo rows are written in one transaction, and only
-- for photos that are really in storage, so a report never points at a photo
-- that didn't upload.
--
-- Access summary (every policy also requires is_active_user()):
--   admin, supervisor  read every report, photo and history entry; review
--   officer            reads their own reports, photos and history; submits
--                      and resubmits through submit_incident()

create type public.incident_severity as enum ('low', 'medium', 'high', 'critical');
create type public.incident_status as enum ('submitted', 'under_review', 'approved', 'returned');

-- ---------------------------------------------------------------------------
-- incidents
-- ---------------------------------------------------------------------------

create table public.incidents (
  id uuid primary key, -- chosen by the phone, so retries can't create duplicates
  site_id uuid not null references public.sites (id) on delete restrict,
  shift_id uuid references public.shifts (id) on delete set null,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  occurred_at timestamptz not null,
  -- Keep in sync with INCIDENT_CATEGORIES in packages/shared.
  category text not null check (category in (
    'theft', 'trespass', 'vandalism', 'assault', 'fire', 'medical', 'suspicious_activity',
    'safety_hazard', 'property_damage', 'alarm', 'other'
  )),
  severity public.incident_severity not null,
  description text not null check (char_length(btrim(description)) between 1 and 10000),
  people_involved text check (char_length(people_involved) <= 4000),
  police_called boolean not null default false,
  status public.incident_status not null default 'submitted',
  submitted_at timestamptz not null default now(), -- latest (re)submission
  reviewer_id uuid references public.profiles (id) on delete set null,
  review_notes text check (char_length(review_notes) <= 4000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.incidents is
  'Incident reports. Written only by submit_incident() and review_incident().';

create index incidents_status_idx on public.incidents (status, occurred_at desc);
create index incidents_officer_idx on public.incidents (officer_id, created_at desc);
create index incidents_site_idx on public.incidents (site_id, occurred_at desc);

create trigger incidents_set_updated_at
  before update on public.incidents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- incident_photos
-- ---------------------------------------------------------------------------

create table public.incident_photos (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete restrict,
  -- Object path in the `incident-photos` bucket: <officer_id>/<incident_id>/<file>
  storage_path text not null unique check (char_length(storage_path) <= 300),
  created_at timestamptz not null default now()
);

create index incident_photos_incident_idx on public.incident_photos (incident_id, created_at);

-- ---------------------------------------------------------------------------
-- incident_status_history (audit log)
-- ---------------------------------------------------------------------------

create table public.incident_status_history (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete restrict,
  from_status public.incident_status, -- null when the report was first submitted
  to_status public.incident_status not null,
  changed_by uuid references public.profiles (id) on delete set null,
  notes text,
  changed_at timestamptz not null default now()
);

comment on table public.incident_status_history is
  'Audit log of incident status changes. Append-only, written by trigger.';

create index incident_status_history_incident_idx
  on public.incident_status_history (incident_id, changed_at);

create function public.incidents_log_status()
returns trigger
language plpgsql
security definer -- nobody can write the audit log directly
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.incident_status_history (incident_id, from_status, to_status, changed_by, notes)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      auth.uid(),
      case when new.status in ('approved', 'returned') then new.review_notes end
    );
  end if;
  return null;
end;
$$;

create trigger incidents_log_status
  after insert or update of status on public.incidents
  for each row execute function public.incidents_log_status();

-- ---------------------------------------------------------------------------
-- submit_incident: create a report, or resubmit a returned one
-- ---------------------------------------------------------------------------

create function public.submit_incident(
  p_id uuid,
  p_site_id uuid,
  p_shift_id uuid,
  p_occurred_at timestamptz,
  p_category text,
  p_severity public.incident_severity,
  p_description text,
  p_people_involved text,
  p_police_called boolean,
  -- Photos already uploaded to incident-photos/<caller>/<p_id>/. On a
  -- resubmission, only new ones are added; earlier photos are kept.
  p_photo_paths text[] default '{}'
)
returns public.incidents
language plpgsql
security definer -- officers have no write access to incidents
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.incidents;
  v_result public.incidents;
  v_shift public.shifts;
  v_path text;
  v_paths text[] := coalesce(p_photo_paths, '{}');
  v_description text := btrim(coalesce(p_description, ''));
  v_people text := nullif(btrim(coalesce(p_people_involved, '')), '');
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  -- Retries first: an id that was already submitted returns as it is. ------
  select * into v_existing from public.incidents where id = p_id for update;
  if found then
    if v_existing.officer_id <> v_uid then
      raise exception 'Incident not found' using errcode = '42501';
    end if;
    if v_existing.status <> 'returned' then
      return v_existing;
    end if;
  end if;

  -- Inputs ------------------------------------------------------------------
  if p_id is null or p_site_id is null or p_occurred_at is null or p_severity is null then
    raise exception 'The report is incomplete' using errcode = '22023';
  end if;
  if char_length(v_description) not between 1 and 10000 then
    raise exception 'Describe what happened (10,000 characters at most)' using errcode = '22023';
  end if;
  if char_length(v_people) > 4000 then
    raise exception 'People involved: 4,000 characters at most' using errcode = '22023';
  end if;
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'The incident time can''t be in the future' using errcode = '22023';
  end if;
  if p_occurred_at < now() - interval '30 days' then
    raise exception 'The incident time is more than 30 days ago. Tell your supervisor instead'
      using errcode = '22023';
  end if;

  -- Where and when ------------------------------------------------------------
  if not exists (select 1 from public.sites s where s.id = p_site_id and s.active)
     or not (
       exists (select 1 from public.site_assignments sa
                where sa.site_id = p_site_id and sa.officer_id = v_uid)
       or coalesce(public.auth_role(), '') in ('admin', 'supervisor')
     )
  then
    raise exception 'You are not assigned to this site' using errcode = '42501';
  end if;
  if p_shift_id is not null then
    select * into v_shift from public.shifts where id = p_shift_id;
    if not found or v_shift.officer_id <> v_uid or v_shift.site_id <> p_site_id then
      raise exception 'That shift isn''t yours at this site' using errcode = '42501';
    end if;
  end if;

  -- Photos: in the caller's folder for this report, and really uploaded. -----
  if cardinality(v_paths) > 10 then
    raise exception 'At most 10 photos per report' using errcode = '22023';
  end if;
  foreach v_path in array v_paths loop
    if split_part(v_path, '/', 1) <> v_uid::text
       or split_part(v_path, '/', 2) <> p_id::text
       or split_part(v_path, '/', 3) = ''
       or split_part(v_path, '/', 4) <> ''
    then
      raise exception 'Invalid photo' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'incident-photos' and o.name = v_path
    ) then
      raise exception 'A photo hasn''t finished uploading' using errcode = 'P0001';
    end if;
  end loop;

  -- Write -----------------------------------------------------------------------
  if v_existing.id is null then
    insert into public.incidents (
      id, site_id, shift_id, officer_id, occurred_at, category, severity, description,
      people_involved, police_called, status, submitted_at
    ) values (
      p_id, p_site_id, p_shift_id, v_uid, p_occurred_at, p_category, p_severity, v_description,
      v_people, coalesce(p_police_called, false), 'submitted', now()
    )
    returning * into v_result;
  else
    update public.incidents
       set site_id = p_site_id,
           shift_id = p_shift_id,
           occurred_at = p_occurred_at,
           category = p_category,
           severity = p_severity,
           description = v_description,
           people_involved = v_people,
           police_called = coalesce(p_police_called, false),
           status = 'submitted',
           submitted_at = now()
     where id = p_id
    returning * into v_result;
  end if;

  insert into public.incident_photos (incident_id, storage_path)
  select p_id, path from unnest(v_paths) as path
  on conflict (storage_path) do nothing;

  if (select count(*) from public.incident_photos where incident_id = p_id) > 10 then
    raise exception 'At most 10 photos per report' using errcode = '22023';
  end if;

  return v_result;
end;
$$;

comment on function public.submit_incident is
  'Officer submits a new incident report, or resubmits their returned one. Idempotent for retries.';

revoke execute on function public.submit_incident from public, anon;
grant execute on function public.submit_incident to authenticated;

-- ---------------------------------------------------------------------------
-- review_incident: admins and supervisors
-- ---------------------------------------------------------------------------

create function public.review_incident(
  p_incident_id uuid,
  p_status public.incident_status,
  p_notes text default null
)
returns public.incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_incident public.incidents;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_uid is null or not public.is_active_user()
     or coalesce(public.auth_role(), '') not in ('admin', 'supervisor') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'Incident not found' using errcode = '42501';
  end if;
  if v_incident.officer_id = v_uid then
    raise exception 'You can''t review your own report' using errcode = '42501';
  end if;
  if char_length(v_notes) > 4000 then
    raise exception 'Notes: 4,000 characters at most' using errcode = '22023';
  end if;

  if p_status = 'under_review' then
    if v_incident.status <> 'submitted' then
      raise exception 'This report is %', replace(v_incident.status::text, '_', ' ')
        using errcode = 'P0001';
    end if;
    update public.incidents set status = 'under_review', reviewer_id = v_uid
     where id = p_incident_id
    returning * into v_incident;
  elsif p_status in ('approved', 'returned') then
    if v_incident.status not in ('submitted', 'under_review') then
      raise exception 'This report is %', replace(v_incident.status::text, '_', ' ')
        using errcode = 'P0001';
    end if;
    if p_status = 'returned' and v_notes is null then
      raise exception 'Say what the officer needs to change' using errcode = '22023';
    end if;
    update public.incidents
       set status = p_status, reviewer_id = v_uid, review_notes = v_notes, reviewed_at = now()
     where id = p_incident_id
    returning * into v_incident;
  else
    raise exception 'Only the officer can submit a report' using errcode = '22023';
  end if;

  return v_incident;
end;
$$;

comment on function public.review_incident is
  'Admin/supervisor moves an incident to under_review, approved or returned (notes required).';

revoke execute on function public.review_incident from public, anon;
grant execute on function public.review_incident to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.incidents enable row level security;
alter table public.incident_photos enable row level security;
alter table public.incident_status_history enable row level security;

revoke all on public.incidents, public.incident_photos, public.incident_status_history
  from anon, authenticated;
-- Read-only through the API: written by the functions and trigger above.
grant select on public.incidents, public.incident_photos, public.incident_status_history
  to authenticated;
grant all on public.incidents, public.incident_photos, public.incident_status_history
  to service_role;

create policy "incidents: officers read their own"
  on public.incidents for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "incidents: staff read all"
  on public.incidents for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "incident_photos: officers read their own"
  on public.incident_photos for select to authenticated
  using (
    (select public.is_active_user())
    and exists (
      select 1 from public.incidents i
       where i.id = incident_photos.incident_id and i.officer_id = (select auth.uid())
    )
  );

create policy "incident_photos: staff read all"
  on public.incident_photos for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

create policy "incident_status_history: officers read their own"
  on public.incident_status_history for select to authenticated
  using (
    (select public.is_active_user())
    and exists (
      select 1 from public.incidents i
       where i.id = incident_status_history.incident_id and i.officer_id = (select auth.uid())
    )
  );

create policy "incident_status_history: staff read all"
  on public.incident_status_history for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) in ('admin', 'supervisor'));

-- ---------------------------------------------------------------------------
-- Storage: private `incident-photos` bucket
-- Path convention: <officer_id>/<incident_id>/<photo id>.jpg
-- The phone re-encodes every photo as JPEG (which drops EXIF, including GPS)
-- before uploading. Uploads happen before the report exists (offline queue),
-- so the policy can only check the folder; submit_incident() decides which
-- files become part of a report.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-photos', 'incident-photos', false, 10 * 1024 * 1024, array['image/jpeg']);

create policy "incident-photos: users read their own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'incident-photos'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "incident-photos: staff read all"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'incident-photos'
    and (select public.is_active_user())
    and (select public.auth_role()) in ('admin', 'supervisor')
  );

create policy "incident-photos: users upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'incident-photos'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "incident-photos: admins delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'incident-photos'
    and (select public.is_active_user())
    and (select public.auth_role()) = 'admin'
  );
