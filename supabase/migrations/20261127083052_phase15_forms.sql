-- Phase 15: forms. Admins upload a PDF form, place fields on its pages and
-- assign it; officers fill it in on the phone and sign; the Edge Function
-- generate-filled-pdf turns the answers into a flattened, signed PDF.
--
-- form_templates    one PDF form. Its content (PDF, page images, fields) can
--                   change only while it is a draft. Each draft -> published
--                   raises `version` by one (first publish = 1).
-- form_fields       where each answer goes: page + x/y/width/height as
--                   fractions of the page size, from the top-left corner.
--                   AcroForm fields are filled by acroform_name instead.
-- form_assignments  who must fill a form: exactly one of an officer, a site
--                   (everyone assigned to it) or a role. Only published forms.
-- form_submissions  an officer's answers: draft -> submitted (only through
--                   generate-filled-pdf) -> approved | returned; returned ->
--                   edited -> submitted again. `values` is {field key: answer}.
--
-- Submitting: the phone saves the draft (values, signature PNG in storage),
-- then calls generate-filled-pdf. The function validates the answers with the
-- shared Zod schema (formValuesSchema), builds the PDF, uploads it and calls
-- complete_form_submission() (service role only), which refuses if the draft
-- changed meanwhile, so the PDF always matches the stored answers.
--
-- Access summary (every policy also requires is_active_user()):
--   admin       everything (tables and both buckets)
--   supervisor  reads non-draft templates, their fields and all assignments;
--               reads submissions "for their sites": the supervisor is in
--               site_assignments for the assignment's site, or for a site the
--               submitting officer is assigned to. Reviews those submissions
--               with review_form_submission().
--   officer     reads published templates assigned to them (directly, via a
--               site they are assigned to, or via their role), their fields
--               and files; reads only their own submissions; creates drafts
--               and edits them only while draft or returned.

create type public.form_field_type as enum (
  'text', 'multiline', 'number', 'date', 'checkbox', 'select', 'signature'
);
create type public.form_template_status as enum ('draft', 'published', 'archived');
create type public.form_submission_status as enum ('draft', 'submitted', 'returned', 'approved');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 4000),
  -- Files in the form-templates bucket, under <id>/.
  original_pdf_path text check (char_length(original_pdf_path) <= 500),
  page_count integer check (page_count between 1 and 200),
  page_image_paths text[] not null default '{}',
  version integer not null default 0 check (version >= 0),
  status public.form_template_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.form_templates is
  'PDF forms. Content changes only while draft; version counts publishes.';

create table public.form_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_templates (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  type public.form_field_type not null,
  -- select: JSON array of the choices (strings). Others: null or an object.
  options jsonb check (options is null or jsonb_typeof(options) in ('array', 'object')),
  required boolean not null default false,
  page integer not null check (page >= 1),
  -- Fractions of the page size, from the top-left corner.
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  width double precision not null check (width > 0 and width <= 1),
  height double precision not null check (height > 0 and height <= 1),
  font_size real not null default 10 check (font_size between 4 and 72),
  sort_order integer not null default 0,
  acroform_name text check (char_length(btrim(acroform_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (template_id, key),
  check (x + width <= 1.0001 and y + height <= 1.0001),
  check (type <> 'select' or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 1))
);

create index form_fields_template_id_idx on public.form_fields (template_id, sort_order);

create table public.form_assignments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_templates (id) on delete cascade,
  -- The template's version when it was assigned (set by trigger).
  template_version integer not null default 0,
  officer_id uuid references public.profiles (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  role public.user_role,
  due_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(officer_id, site_id, role) = 1)
);

create index form_assignments_template_id_idx on public.form_assignments (template_id);
create index form_assignments_officer_id_idx on public.form_assignments (officer_id) where officer_id is not null;
create index form_assignments_site_id_idx on public.form_assignments (site_id) where site_id is not null;

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(), -- the phone may choose it
  template_id uuid not null references public.form_templates (id) on delete restrict,
  -- The template version the answers were made / submitted against (trigger).
  template_version integer not null default 0,
  assignment_id uuid references public.form_assignments (id) on delete set null,
  officer_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  status public.form_submission_status not null default 'draft',
  "values" jsonb not null default '{}'
    check (jsonb_typeof("values") = 'object' and pg_column_size("values") <= 262144),
  -- Files in the form-submissions bucket, under <officer_id>/<id>/.
  signature_path text check (char_length(signature_path) <= 500),
  signed_at timestamptz, -- server time, set at submit
  device_id text check (char_length(device_id) between 1 and 200),
  submitted_at timestamptz,
  reviewer_id uuid references public.profiles (id) on delete set null,
  review_notes text check (char_length(review_notes) <= 4000),
  reviewed_at timestamptz,
  filled_pdf_path text check (char_length(filled_pdf_path) <= 500),
  filled_pdf_sha256 text check (filled_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Anything past draft has been through generate-filled-pdf.
  check (status = 'draft' or (submitted_at is not null and signed_at is not null
                              and filled_pdf_path is not null and filled_pdf_sha256 is not null))
);

create index form_submissions_officer_id_idx on public.form_submissions (officer_id, created_at desc);
create index form_submissions_template_id_idx on public.form_submissions (template_id);
create index form_submissions_assignment_id_idx on public.form_submissions (assignment_id);
create index form_submissions_status_idx on public.form_submissions (status, submitted_at);
-- One submission per officer per assignment (ad-hoc ones have no assignment).
create unique index form_submissions_one_per_assignment
  on public.form_submissions (assignment_id, officer_id) where assignment_id is not null;

-- ---------------------------------------------------------------------------
-- Access helpers (security definer: they read across tables without RLS
-- recursion; each one only answers about the caller)
-- ---------------------------------------------------------------------------

/** True when the assignment applies to the caller: to them, their role, or a site they are assigned to. */
create function public.form_assignment_applies_to_me(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_active_user() and exists (
    select 1 from public.form_assignments a
     where a.id = p_assignment_id
       and (a.officer_id = auth.uid()
            or a.role = public.auth_role()
            or a.site_id in (select sa.site_id from public.site_assignments sa
                              where sa.officer_id = auth.uid()))
  ), false)
$$;

/** True when the template is published and assigned to the caller. */
create function public.form_template_visible_to_me(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_active_user()
    and exists (select 1 from public.form_templates t
                 where t.id = p_template_id and t.status = 'published')
    and exists (
      select 1 from public.form_assignments a
       where a.template_id = p_template_id
         and (a.officer_id = auth.uid()
              or a.role = public.auth_role()
              or a.site_id in (select sa.site_id from public.site_assignments sa
                                where sa.officer_id = auth.uid()))
    ),
    false
  )
$$;

/**
 * True when the caller is an active supervisor for a submission's site: they
 * are assigned to the assignment's site, or to a site the officer works at.
 */
create function public.supervises_form_submission(p_officer_id uuid, p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_active_user()
    and public.auth_role() = 'supervisor'
    and exists (
      select 1 from public.site_assignments mine
       where mine.officer_id = auth.uid()
         and (
           mine.site_id = (select a.site_id from public.form_assignments a where a.id = p_assignment_id)
           or exists (select 1 from public.site_assignments theirs
                       where theirs.officer_id = p_officer_id and theirs.site_id = mine.site_id)
         )
    ),
    false
  )
$$;

-- Storage helpers. Object names are checked for a UUID before casting.

/** form-templates/<template_id>/...: readable by officers the template is assigned to. */
create function public.can_read_form_template_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.form_template_visible_to_me(((storage.foldername(p_name))[1])::uuid)
    else false
  end
$$;

/** form-submissions/<officer_id>/<submission_id>/...: the caller's own draft or returned submission. */
create function public.can_upload_form_submission_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from public.form_submissions s
         where s.id = ((storage.foldername(p_name))[2])::uuid
           and s.officer_id = auth.uid()
           and s.officer_id::text = (storage.foldername(p_name))[1]
           and s.status in ('draft', 'returned')
      )
    else false
  end
$$;

/** form-submissions/<officer_id>/<submission_id>/...: a submission the caller supervises. */
create function public.supervises_form_submission_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from public.form_submissions s
         where s.id = ((storage.foldername(p_name))[2])::uuid
           and s.officer_id::text = (storage.foldername(p_name))[1]
           and public.supervises_form_submission(s.officer_id, s.assignment_id)
      )
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.form_templates_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      new.created_by := auth.uid();
    end if;
    new.version := case when new.status = 'published' then 1 else 0 end;
    new.created_at := now();
  else
    if new.id <> old.id then
      raise exception 'A form''s id can''t change' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status <> 'draft'
       and (new.original_pdf_path, new.page_count, new.page_image_paths)
           is distinct from (old.original_pdf_path, old.page_count, old.page_image_paths)
    then
      raise exception 'Set the form back to draft before changing its PDF' using errcode = 'P0001';
    end if;
    new.version := case
      when new.status = 'published' and old.status = 'draft' then old.version + 1
      else old.version
    end;
  end if;

  if new.original_pdf_path is not null and new.original_pdf_path not like new.id::text || '/%' then
    raise exception 'The PDF must be in the form''s folder' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.page_image_paths) p
              where p is null or p not like new.id::text || '/%') then
    raise exception 'Page images must be in the form''s folder' using errcode = '22023';
  end if;

  if new.status = 'published' then
    if new.original_pdf_path is null or new.page_count is null
       or cardinality(new.page_image_paths) <> new.page_count then
      raise exception 'Upload the PDF (and its page images) before publishing the form'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.form_fields f
                where f.template_id = new.id and f.page > new.page_count) then
      raise exception 'A field is on a page the PDF doesn''t have' using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger form_templates_before_write
  before insert or update on public.form_templates
  for each row execute function public.form_templates_before_write();

/** Fields change only while their template is a draft (published PDFs stay reproducible). */
create function public.form_fields_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_template_id uuid;
  v_status public.form_template_status;
  v_pages integer;
begin
  if tg_op = 'DELETE' then
    v_template_id := old.template_id;
  else
    v_template_id := new.template_id;
    if tg_op = 'UPDATE' and new.template_id <> old.template_id then
      raise exception 'A field can''t move to another form' using errcode = '22023';
    end if;
  end if;

  select t.status, t.page_count into v_status, v_pages
    from public.form_templates t where t.id = v_template_id;

  -- Not found: the template itself is being deleted (cascade).
  if found and v_status <> 'draft' then
    raise exception 'This form is %: set it back to draft to change its fields', v_status
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if v_pages is not null and new.page > v_pages then
    raise exception 'The PDF has only % page(s)', v_pages using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger form_fields_guard
  before insert or update or delete on public.form_fields
  for each row execute function public.form_fields_guard();

create function public.form_assignments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_template public.form_templates;
begin
  if tg_op = 'INSERT' then
    select * into v_template from public.form_templates where id = new.template_id;
    if not found or v_template.status <> 'published' then
      raise exception 'Publish the form before assigning it' using errcode = 'P0001';
    end if;
    new.template_version := v_template.version;
    if current_user in ('anon', 'authenticated') then
      new.created_by := auth.uid();
    end if;
    new.created_at := now();
  else
    if new.template_id <> old.template_id then
      raise exception 'An assignment can''t move to another form' using errcode = '22023';
    end if;
    new.template_version := old.template_version;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger form_assignments_before_write
  before insert or update on public.form_assignments
  for each row execute function public.form_assignments_before_write();

/**
 * Officers (anyone but admins, through the API) may only create their own
 * drafts and change values / signature_path / device_id. Status and the
 * review and PDF columns are set by complete_form_submission() and
 * review_form_submission(). RLS limits edits to draft and returned rows.
 */
create function public.form_submissions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_template public.form_templates;
  v_trusted boolean := current_user not in ('anon', 'authenticated')
                       or public.auth_role() is not distinct from 'admin';
  col text;
begin
  if tg_op = 'INSERT' then
    select * into v_template from public.form_templates where id = new.template_id;
    if not found then
      raise exception 'Form not found' using errcode = '42501';
    end if;

    if not v_trusted then
      if new.officer_id is distinct from auth.uid() then
        raise exception 'You can only fill in forms as yourself' using errcode = '42501';
      end if;
      if new.status <> 'draft'
         or num_nonnulls(new.signed_at, new.submitted_at, new.reviewer_id, new.review_notes,
                         new.reviewed_at, new.filled_pdf_path, new.filled_pdf_sha256) > 0 then
        raise exception 'A new form starts as a draft' using errcode = '42501';
      end if;
      if not public.form_template_visible_to_me(new.template_id) then
        raise exception 'Form not found' using errcode = '42501';
      end if;
    end if;

    if new.assignment_id is not null then
      if not exists (select 1 from public.form_assignments a
                      where a.id = new.assignment_id and a.template_id = new.template_id)
         or (not v_trusted and not public.form_assignment_applies_to_me(new.assignment_id)) then
        raise exception 'This form isn''t assigned to you' using errcode = '42501';
      end if;
    end if;

    new.template_version := v_template.version;
    new.created_at := now();
  else
    if new.id <> old.id or new.officer_id <> old.officer_id or new.template_id <> old.template_id then
      raise exception 'A submission''s id, officer and form can''t change' using errcode = '42501';
    end if;
    if not v_trusted then
      foreach col in array array[
        'assignment_id', 'template_version', 'status', 'signed_at', 'submitted_at', 'reviewer_id',
        'review_notes', 'reviewed_at', 'filled_pdf_path', 'filled_pdf_sha256', 'created_at'
      ] loop
        if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
          raise exception 'You can''t change form_submissions.%', col using errcode = '42501';
        end if;
      end loop;
    end if;
  end if;

  if new.signature_path is not null
     and new.signature_path not like new.officer_id::text || '/' || new.id::text || '/%' then
    raise exception 'The signature must be in this form''s folder' using errcode = '22023';
  end if;
  if new.filled_pdf_path is not null
     and new.filled_pdf_path not like new.officer_id::text || '/' || new.id::text || '/%' then
    raise exception 'The PDF must be in this form''s folder' using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger form_submissions_before_write
  before insert or update on public.form_submissions
  for each row execute function public.form_submissions_before_write();

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

/**
 * Called only by generate-filled-pdf (service role) after it uploaded the
 * filled PDF. Refuses when the submission is no longer editable or its
 * answers / signature / template changed after the function read them.
 */
create function public.complete_form_submission(
  p_id uuid,
  p_expected_values jsonb,
  p_expected_signature_path text,
  p_template_version integer,
  p_signed_at timestamptz,
  p_pdf_path text,
  p_sha256 text
)
returns public.form_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.form_submissions;
begin
  select * into v from public.form_submissions where id = p_id for update;
  if not found then
    raise exception 'Form not found' using errcode = '42501';
  end if;
  if v.status not in ('draft', 'returned') then
    raise exception 'This form was already submitted' using errcode = 'P0001';
  end if;
  if v."values" is distinct from p_expected_values
     or v.signature_path is distinct from p_expected_signature_path
     or p_template_version is distinct from
        (select t.version from public.form_templates t
          where t.id = v.template_id and t.status = 'published')
  then
    raise exception 'The form changed while it was being submitted. Try again'
      using errcode = '40001';
  end if;
  if p_signed_at is null or p_signed_at < now() - interval '15 minutes'
     or p_signed_at > now() + interval '1 minute' then
    raise exception 'Invalid signing time' using errcode = '22023';
  end if;

  update public.form_submissions
     set status = 'submitted',
         submitted_at = now(),
         signed_at = p_signed_at,
         template_version = p_template_version,
         filled_pdf_path = p_pdf_path,
         filled_pdf_sha256 = p_sha256
   where id = p_id
  returning * into v;
  return v;
end;
$$;

/** Admins, and supervisors for their sites: approve or return (notes required) a submitted form. */
create function public.review_form_submission(
  p_id uuid,
  p_status public.form_submission_status,
  p_notes text default null
)
returns public.form_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.form_submissions;
  v_notes text := nullif(btrim(p_notes), '');
begin
  if not public.is_active_user() or public.auth_role() not in ('admin', 'supervisor') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v from public.form_submissions where id = p_id for update;
  if not found
     or (public.auth_role() = 'supervisor'
         and not public.supervises_form_submission(v.officer_id, v.assignment_id)) then
    raise exception 'Form not found' using errcode = '42501';
  end if;
  if v.officer_id = auth.uid() then
    raise exception 'You can''t review your own form' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'returned') then
    raise exception 'A form can only be approved or returned' using errcode = '22023';
  end if;
  if v.status <> 'submitted' then
    raise exception 'Only a submitted form can be reviewed (this one is %)', v.status
      using errcode = 'P0001';
  end if;
  if p_status = 'returned' and v_notes is null then
    raise exception 'Say what needs fixing before returning the form' using errcode = '22023';
  end if;
  if char_length(v_notes) > 4000 then
    raise exception 'The notes are too long (4000 characters at most)' using errcode = '22023';
  end if;

  update public.form_submissions
     set status = p_status, reviewer_id = auth.uid(), review_notes = v_notes, reviewed_at = now()
   where id = p_id
  returning * into v;
  return v;
end;
$$;

revoke execute on function
  public.form_assignment_applies_to_me(uuid),
  public.form_template_visible_to_me(uuid),
  public.supervises_form_submission(uuid, uuid),
  public.can_read_form_template_file(text),
  public.can_upload_form_submission_file(text),
  public.supervises_form_submission_file(text),
  public.complete_form_submission(uuid, jsonb, text, integer, timestamptz, text, text),
  public.review_form_submission(uuid, public.form_submission_status, text)
  from public, anon;
grant execute on function
  public.form_assignment_applies_to_me(uuid),
  public.form_template_visible_to_me(uuid),
  public.supervises_form_submission(uuid, uuid),
  public.can_read_form_template_file(text),
  public.can_upload_form_submission_file(text),
  public.supervises_form_submission_file(text),
  public.review_form_submission(uuid, public.form_submission_status, text)
  to authenticated;
revoke execute on function
  public.complete_form_submission(uuid, jsonb, text, integer, timestamptz, text, text)
  from authenticated;
grant execute on function
  public.complete_form_submission(uuid, jsonb, text, integer, timestamptz, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS (this project grants new tables to API roles explicitly)
-- ---------------------------------------------------------------------------

alter table public.form_templates enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_assignments enable row level security;
alter table public.form_submissions enable row level security;

revoke all on public.form_templates, public.form_fields, public.form_assignments,
  public.form_submissions from anon, authenticated;
grant select, insert, update, delete on public.form_templates, public.form_fields,
  public.form_assignments, public.form_submissions to authenticated;
grant all on public.form_templates, public.form_fields, public.form_assignments,
  public.form_submissions to service_role;

-- form_templates ------------------------------------------------------------

create policy "form_templates: admins full access"
  on public.form_templates for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "form_templates: supervisors read non-draft"
  on public.form_templates for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'supervisor'
         and status <> 'draft');

create policy "form_templates: officers read published and assigned"
  on public.form_templates for select to authenticated
  using ((select public.is_active_user()) and public.form_template_visible_to_me(id));

-- form_fields ---------------------------------------------------------------

create policy "form_fields: admins full access"
  on public.form_fields for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "form_fields: supervisors read non-draft"
  on public.form_fields for select to authenticated
  using (
    (select public.is_active_user()) and (select public.auth_role()) = 'supervisor'
    and exists (select 1 from public.form_templates t
                 where t.id = form_fields.template_id and t.status <> 'draft')
  );

create policy "form_fields: officers read published and assigned"
  on public.form_fields for select to authenticated
  using ((select public.is_active_user()) and public.form_template_visible_to_me(template_id));

-- form_assignments ----------------------------------------------------------

create policy "form_assignments: admins full access"
  on public.form_assignments for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "form_assignments: supervisors read all"
  on public.form_assignments for select to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'supervisor');

create policy "form_assignments: officers read their own"
  on public.form_assignments for select to authenticated
  using (
    (select public.is_active_user())
    and public.form_assignment_applies_to_me(id)
    and public.form_template_visible_to_me(template_id)
  );

-- form_submissions ----------------------------------------------------------

create policy "form_submissions: admins full access"
  on public.form_submissions for all to authenticated
  using ((select public.is_active_user()) and (select public.auth_role()) = 'admin')
  with check ((select public.is_active_user()) and (select public.auth_role()) = 'admin');

create policy "form_submissions: supervisors read for their sites"
  on public.form_submissions for select to authenticated
  using ((select public.is_active_user())
         and public.supervises_form_submission(officer_id, assignment_id));

create policy "form_submissions: officers read their own"
  on public.form_submissions for select to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid()));

create policy "form_submissions: officers create their own drafts"
  on public.form_submissions for insert to authenticated
  with check ((select public.is_active_user()) and officer_id = (select auth.uid())
              and status = 'draft');

create policy "form_submissions: officers edit their own while draft or returned"
  on public.form_submissions for update to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid())
         and status in ('draft', 'returned'))
  with check ((select public.is_active_user()) and officer_id = (select auth.uid())
              and status in ('draft', 'returned'));

create policy "form_submissions: officers delete their own drafts"
  on public.form_submissions for delete to authenticated
  using ((select public.is_active_user()) and officer_id = (select auth.uid())
         and status = 'draft');

-- ---------------------------------------------------------------------------
-- Storage: private buckets
--   form-templates    <template_id>/original.pdf, <template_id>/page-<n>.png
--   form-submissions  <officer_id>/<submission_id>/signature-*.png (phone)
--                     <officer_id>/<submission_id>/filled-*.pdf (Edge Function)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('form-templates', 'form-templates', false, 50 * 1024 * 1024,
   array['application/pdf', 'image/png', 'image/jpeg']),
  ('form-submissions', 'form-submissions', false, 20 * 1024 * 1024,
   array['image/png', 'application/pdf']);

create policy "form-templates: admins full access"
  on storage.objects for all to authenticated
  using (bucket_id = 'form-templates' and (select public.is_active_user())
         and (select public.auth_role()) = 'admin')
  with check (bucket_id = 'form-templates' and (select public.is_active_user())
              and (select public.auth_role()) = 'admin');

create policy "form-templates: supervisors read"
  on storage.objects for select to authenticated
  using (bucket_id = 'form-templates' and (select public.is_active_user())
         and (select public.auth_role()) = 'supervisor');

create policy "form-templates: officers read assigned templates"
  on storage.objects for select to authenticated
  using (bucket_id = 'form-templates' and public.can_read_form_template_file(name));

create policy "form-submissions: admins read"
  on storage.objects for select to authenticated
  using (bucket_id = 'form-submissions' and (select public.is_active_user())
         and (select public.auth_role()) = 'admin');

create policy "form-submissions: admins delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'form-submissions' and (select public.is_active_user())
         and (select public.auth_role()) = 'admin');

create policy "form-submissions: supervisors read for their sites"
  on storage.objects for select to authenticated
  using (bucket_id = 'form-submissions' and public.supervises_form_submission_file(name));

create policy "form-submissions: officers read their own"
  on storage.objects for select to authenticated
  using (bucket_id = 'form-submissions' and (select public.is_active_user())
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Officers upload only PNG signatures, into a draft or returned submission of
-- their own. The filled PDF is written by the Edge Function (service role).
create policy "form-submissions: officers upload signatures"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'form-submissions'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(name) like '%.png'
    and public.can_upload_form_submission_file(name)
  );
