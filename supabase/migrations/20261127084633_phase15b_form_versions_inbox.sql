-- Phase 15b: form versions, publishing, notifications and the review inbox.
--
-- Versions. A template is now a WORKING COPY that admins can edit at any time
-- (except while archived). publish_form_template() freezes it into
-- form_template_versions (PDF, page images and fields) and raises
-- form_templates.version. Officers and generate-filled-pdf read only the
-- frozen version, so edits are invisible until published, and a submission
-- keeps the version it was filled on (form_submissions.template_version).
-- Files are never overwritten: each PDF upload goes to a new folder
-- <template_id>/<upload_id>/, so old versions keep their files.
--
-- Status: draft (never published) -> published <-> archived. A published form
-- can't go back to draft; archive it instead.
--
-- Notifications (notify_users -> push via send-notification):
--   form_assigned            to everyone an assignment reaches
--   form_returned / approved to the officer, when a submission is reviewed
--
-- form_inbox(): the console's submissions inbox, including "not started"
-- rows (assigned, nothing saved yet) so overdue work shows up.

-- ---------------------------------------------------------------------------
-- Frozen versions
-- ---------------------------------------------------------------------------

create table public.form_template_versions (
  template_id uuid not null references public.form_templates (id) on delete cascade,
  version integer not null check (version >= 1),
  title text not null,
  description text,
  original_pdf_path text not null,
  page_count integer not null,
  page_image_paths text[] not null,
  -- [{key, label, type, options, required, page, x, y, width, height,
  --   font_size, sort_order, acroform_name}] in sort order.
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  primary key (template_id, version)
);

comment on table public.form_template_versions is
  'Frozen published versions of form templates. Written only by publish_form_template().';

alter table public.form_template_versions enable row level security;
revoke all on public.form_template_versions from anon, authenticated;
grant select on public.form_template_versions to authenticated;
grant all on public.form_template_versions to service_role;

create policy "form_template_versions: staff read all"
  on public.form_template_versions for select to authenticated
  using ((select public.is_staff()));

create policy "form_template_versions: officers read assigned forms"
  on public.form_template_versions for select to authenticated
  using ((select public.is_active_user()) and public.form_template_visible_to_me(template_id));

-- Officers now read fields from the frozen version, never the working copy.
drop policy "form_fields: officers read published and assigned" on public.form_fields;

-- When the working copy last changed (shown as "unpublished changes").
alter table public.form_templates add column edited_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Template and field rules (replace the phase 15 versions)
-- ---------------------------------------------------------------------------

create or replace function public.form_templates_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- publish_form_template() and the service role; not API users.
  v_trusted boolean := current_user not in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if not v_trusted then
      new.created_by := auth.uid();
    end if;
    if new.status <> 'draft' then
      raise exception 'A new form starts as a draft' using errcode = 'P0001';
    end if;
    new.version := 0;
    new.created_at := now();
    new.edited_at := now();
  else
    if new.id <> old.id then
      raise exception 'A form''s id can''t change' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if not v_trusted then
      new.version := old.version;
    end if;

    if (new.title, new.description, new.original_pdf_path, new.page_count, new.page_image_paths)
       is distinct from
       (old.title, old.description, old.original_pdf_path, old.page_count, old.page_image_paths)
    then
      if old.status = 'archived' and new.status = 'archived' then
        raise exception 'Restore the form before changing it' using errcode = 'P0001';
      end if;
      new.edited_at := now();
    end if;

    if new.status = 'draft' and old.status <> 'draft' then
      raise exception 'A published form can''t go back to draft: archive it instead'
        using errcode = 'P0001';
    end if;
    if new.status = 'published' and not exists (
      select 1 from public.form_template_versions v
       where v.template_id = new.id and v.version = new.version
    ) then
      raise exception 'Publish the form to make it available' using errcode = 'P0001';
    end if;
  end if;

  if new.original_pdf_path is not null and new.original_pdf_path not like new.id::text || '/%' then
    raise exception 'The PDF must be in the form''s folder' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.page_image_paths) p
              where p is null or p not like new.id::text || '/%') then
    raise exception 'Page images must be in the form''s folder' using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

/** Fields can change unless the form is archived; every change marks the working copy edited. */
create or replace function public.form_fields_guard()
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

  if found then
    if v_status = 'archived' then
      raise exception 'Restore the form before changing its fields' using errcode = 'P0001';
    end if;
    update public.form_templates set edited_at = now() where id = v_template_id;
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

-- ---------------------------------------------------------------------------
-- Saving fields and publishing
-- ---------------------------------------------------------------------------

/**
 * Admins: replace all of a template's fields in one transaction (the editor
 * saves the whole list). Runs as the caller, so RLS applies. The console
 * validates each field with formFieldSchema first; the table checks again.
 */
create function public.replace_form_fields(p_template_id uuid, p_fields jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_active_user() or public.auth_role() is distinct from 'admin' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fields) <> 'array' then
    raise exception 'Fields must be a list' using errcode = '22023';
  end if;
  if not exists (select 1 from public.form_templates where id = p_template_id) then
    raise exception 'Form not found' using errcode = '42501';
  end if;

  delete from public.form_fields where template_id = p_template_id;

  insert into public.form_fields (
    template_id, key, label, type, options, required, page, x, y, width, height, font_size,
    sort_order, acroform_name
  )
  select p_template_id, r.key, r.label, r.type::public.form_field_type, r.options,
         coalesce(r.required, false), r.page, r.x, r.y, r.width, r.height,
         coalesce(r.font_size, 10), coalesce(r.sort_order, 0), r.acroform_name
    from jsonb_to_recordset(p_fields) as r(
      key text, label text, type text, options jsonb, required boolean, page integer,
      x double precision, y double precision, width double precision, height double precision,
      font_size real, sort_order integer, acroform_name text
    );
  get diagnostics v_count = row_count;

  -- Even an empty list is a change.
  update public.form_templates set edited_at = now() where id = p_template_id;
  return v_count;
end;
$$;

/**
 * Admins: freeze the working copy as the next version and publish it.
 * Returns the new version number.
 */
create function public.publish_form_template(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.form_templates;
  v_fields jsonb;
  v_next integer;
begin
  if not public.is_active_user() or public.auth_role() is distinct from 'admin' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v from public.form_templates where id = p_id for update;
  if not found then
    raise exception 'Form not found' using errcode = '42501';
  end if;
  if v.original_pdf_path is null or v.page_count is null
     or cardinality(v.page_image_paths) <> v.page_count then
    raise exception 'Upload the PDF before publishing the form' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', f.key, 'label', f.label, 'type', f.type, 'options', f.options,
           'required', f.required, 'page', f.page, 'x', f.x, 'y', f.y, 'width', f.width,
           'height', f.height, 'font_size', f.font_size, 'sort_order', f.sort_order,
           'acroform_name', f.acroform_name
         ) order by f.sort_order, f.key), '[]'::jsonb)
    into v_fields
    from public.form_fields f
   where f.template_id = p_id;

  if jsonb_array_length(v_fields) = 0 then
    raise exception 'Add at least one field before publishing' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.form_fields f where f.template_id = p_id and f.page > v.page_count) then
    raise exception 'A field is on a page the PDF doesn''t have' using errcode = 'P0001';
  end if;
  if v.status = 'published' and exists (
    select 1 from public.form_template_versions x
     where x.template_id = p_id and x.version = v.version
       and x.title = v.title and x.description is not distinct from v.description
       and x.original_pdf_path = v.original_pdf_path and x.page_image_paths = v.page_image_paths
       and x.fields = v_fields
  ) then
    raise exception 'Nothing has changed since version %', v.version using errcode = 'P0001';
  end if;

  v_next := v.version + 1;
  insert into public.form_template_versions (
    template_id, version, title, description, original_pdf_path, page_count, page_image_paths,
    fields, published_by
  ) values (
    p_id, v_next, v.title, v.description, v.original_pdf_path, v.page_count, v.page_image_paths,
    v_fields, auth.uid()
  );

  update public.form_templates set version = v_next, status = 'published' where id = p_id;
  return v_next;
end;
$$;

revoke execute on function public.replace_form_fields(uuid, jsonb) from public, anon;
grant execute on function public.replace_form_fields(uuid, jsonb) to authenticated;
revoke execute on function public.publish_form_template(uuid) from public, anon;
grant execute on function public.publish_form_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create function public.notify_form_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_zone text;
  v_users uuid[];
begin
  select title into v_title from public.form_templates where id = new.template_id;
  select time_zone into v_zone from public.settings where id;

  select coalesce(array_agg(p.id), '{}') into v_users
    from public.profiles p
   where p.employment_status = 'active'
     and (p.id = new.officer_id
          or p.role = new.role
          or (new.site_id is not null and exists (
                select 1 from public.site_assignments sa
                 where sa.site_id = new.site_id and sa.officer_id = p.id)));

  perform public.notify_users(
    v_users,
    'form_assigned',
    'New form: ' || coalesce(v_title, 'form'),
    case
      when new.due_at is null then 'Fill it in on the DeltaGuard app.'
      else 'Due ' || to_char(new.due_at at time zone coalesce(v_zone, 'UTC'), 'Mon FMDD, FMHH12:MI AM')
           || '. Fill it in on the DeltaGuard app.'
    end,
    jsonb_build_object('template_id', new.template_id, 'assignment_id', new.id),
    'form_assigned:' || new.id
  );
  return null;
end;
$$;

create trigger form_assignments_notify
  after insert on public.form_assignments
  for each row execute function public.notify_form_assigned();

create function public.notify_form_reviewed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  if new.status = old.status or new.status not in ('returned', 'approved') then
    return null;
  end if;
  select title into v_title from public.form_templates where id = new.template_id;
  perform public.notify_users(
    array[new.officer_id],
    'form_' || new.status::text,
    case when new.status = 'returned' then 'Form returned: ' else 'Form approved: ' end
      || coalesce(v_title, 'form'),
    case when new.status = 'returned'
         then coalesce(new.review_notes, 'Your supervisor asked for changes.')
         else 'Your form was approved.' end,
    jsonb_build_object('submission_id', new.id, 'template_id', new.template_id),
    'form_reviewed:' || new.id || ':' || extract(epoch from coalesce(new.reviewed_at, now()))::bigint
  );
  return null;
end;
$$;

create trigger form_submissions_notify_reviewed
  after update of status on public.form_submissions
  for each row execute function public.notify_form_reviewed();

revoke execute on function public.notify_form_assigned() from public, anon, authenticated;
revoke execute on function public.notify_form_reviewed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

/**
 * Submissions plus "not started" rows (an assignment reaches the officer and
 * they have saved nothing yet), filtered. SECURITY INVOKER: RLS decides what
 * each caller sees; supervisors get not-started rows only for their sites.
 * status: not_started | draft | submitted | returned | approved, or null.
 * Overdue = due date passed and nothing submitted (not_started, draft or
 * returned).
 */
create function public.form_inbox(
  p_template_id uuid default null,
  p_site_id uuid default null,
  p_officer_id uuid default null,
  p_status text default null,
  p_overdue boolean default false,
  p_limit integer default 200,
  p_now timestamptz default now()
)
returns table (
  row_key text,
  submission_id uuid,
  assignment_id uuid,
  template_id uuid,
  template_title text,
  template_version integer,
  officer_id uuid,
  officer_name text,
  status text,
  due_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  overdue boolean,
  has_pdf boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with subs as (
    select s.id as submission_id, s.assignment_id, s.template_id, s.template_version,
           s.officer_id, s.status::text as status, a.due_at, s.submitted_at, s.reviewed_at,
           s.filled_pdf_path is not null as has_pdf, a.site_id as assignment_site,
           s.created_at
      from public.form_submissions s
      left join public.form_assignments a on a.id = s.assignment_id
  ),
  reached as (
    select a.id as assignment_id, a.template_id, a.due_at, a.site_id as assignment_site,
           a.created_at, p.id as officer_id
      from public.form_assignments a
      join public.form_templates t on t.id = a.template_id and t.status = 'published'
      join public.profiles p
        on p.employment_status = 'active'
       and (p.id = a.officer_id
            or p.role = a.role
            or (a.site_id is not null and exists (
                  select 1 from public.site_assignments sa
                   where sa.site_id = a.site_id and sa.officer_id = p.id)))
  ),
  not_started as (
    select null::uuid as submission_id, r.assignment_id, r.template_id,
           null::integer as template_version, r.officer_id, 'not_started'::text as status,
           r.due_at, null::timestamptz as submitted_at, null::timestamptz as reviewed_at,
           false as has_pdf, r.assignment_site, r.created_at
      from reached r
     where not exists (select 1 from public.form_submissions s
                        where s.assignment_id = r.assignment_id and s.officer_id = r.officer_id)
       and (public.auth_role() = 'admin'
            or public.supervises_form_submission(r.officer_id, r.assignment_id))
  ),
  all_rows as (
    select * from subs
    union all
    select * from not_started
  )
  select coalesce(x.submission_id::text, 'a:' || x.assignment_id || ':' || x.officer_id),
         x.submission_id, x.assignment_id, x.template_id, t.title, x.template_version,
         x.officer_id, p.full_name, x.status, x.due_at, x.submitted_at, x.reviewed_at,
         (x.due_at is not null and x.due_at < p_now
          and x.status in ('not_started', 'draft', 'returned')),
         x.has_pdf
    from all_rows x
    join public.form_templates t on t.id = x.template_id
    left join public.profiles p on p.id = x.officer_id
   where public.is_staff()
     and (p_template_id is null or x.template_id = p_template_id)
     and (p_officer_id is null or x.officer_id = p_officer_id)
     and (p_site_id is null
          or x.assignment_site = p_site_id
          or exists (select 1 from public.site_assignments sa
                      where sa.site_id = p_site_id and sa.officer_id = x.officer_id))
     and (p_status is null or x.status = p_status)
     and (not coalesce(p_overdue, false)
          or (x.due_at is not null and x.due_at < p_now
              and x.status in ('not_started', 'draft', 'returned')))
   order by coalesce(x.submitted_at, x.due_at, x.created_at) desc
   limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

revoke execute on function public.form_inbox(uuid, uuid, uuid, text, boolean, integer, timestamptz)
  from public, anon;
grant execute on function public.form_inbox(uuid, uuid, uuid, text, boolean, integer, timestamptz)
  to authenticated;
