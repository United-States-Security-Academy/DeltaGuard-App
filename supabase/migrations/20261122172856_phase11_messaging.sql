-- Phase 11: internal messaging (1:1 and group chats).
--
-- conversations          a direct (1:1) chat or a named group, optionally tied to a site
-- conversation_members   who is in each conversation
-- messages               append-only; text and/or one image (private `chat-attachments` bucket)
-- conversation_reads     read receipts: per member, "read everything up to" a time
--
-- Rules
--   * Everyone reads and sends only in conversations they belong to (RLS).
--   * Conversations and members are written only by the functions below:
--       start_direct_conversation  staff: with any active user; officers: with supervisors
--       create_group_conversation  admins and supervisors; a site group starts with the
--                                  site's assigned people and follows site_assignments
--       add_conversation_members / remove_conversation_member  staff in the group
--                                  (anyone may remove themselves: leave)
--   * Officers can't read other profiles (phase 1), so names come from
--     list_conversations(), conversation_people() and chat_contacts(), which only
--     reveal people the caller shares a conversation with or may start one with.
--   * A new message notifies the other members (type 'message': push only, not
--     shown in the phone's alert inbox).
--   * Terminated users are removed from every conversation (trigger on profiles).
--   * Realtime: messages and conversation_reads are published (RLS applies).
--     Neither is ever deleted through the API, so no unfiltered DELETE events.

create type public.conversation_type as enum ('direct', 'group');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null,
  name text check (name is null or char_length(btrim(name)) between 1 and 100),
  site_id uuid references public.sites (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  -- Direct chats only: "<smaller uuid>:<larger uuid>", so a pair has one chat.
  direct_key text unique,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check ((type = 'group') = (name is not null)),
  check ((type = 'direct') = (direct_key is not null)),
  check (type = 'group' or site_id is null)
);

comment on table public.conversations is
  'Chats. Written only by the messaging functions; members read their own.';

create index conversations_site_idx on public.conversations (site_id) where site_id is not null;

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

comment on table public.conversation_members is 'Who is in each conversation. Written only by the messaging functions.';

create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  -- May be chosen by the client so a retried send can't post twice.
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  body text check (body is null or char_length(btrim(body)) between 1 and 4000),
  -- Object in `chat-attachments`: <conversation_id>/<sender_id>/<file>
  attachment_path text check (
    attachment_path is null
    or (
      char_length(attachment_path) <= 300
      and split_part(attachment_path, '/', 1) = conversation_id::text
      and split_part(attachment_path, '/', 2) = sender_id::text
      and split_part(attachment_path, '/', 3) <> ''
    )
  ),
  created_at timestamptz not null default now(), -- always server time (trigger)
  check (body is not null or attachment_path is not null)
);

comment on table public.messages is 'Chat messages. Append-only: members insert their own, nobody edits or deletes.';

create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (conversation_id, user_id)
);

comment on table public.conversation_reads is
  'Read receipts: each member has read every message up to last_read_at. Written by mark_conversation_read() and the send trigger.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** True when the caller is a member of this conversation (bypasses RLS: used by policies). */
create function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
     where m.conversation_id = p_conversation_id and m.user_id = auth.uid()
  )
$$;

/** Same, for the first folder of a storage path (text; false if it isn't a uuid). */
create function public.is_conversation_folder_member(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.is_conversation_member(p_folder::uuid)
$$;

create function public.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.is_active_user() and public.auth_role() in ('admin', 'supervisor'), false)
$$;

/** Adds active users to a conversation (skips anyone already in it). Returns who was added. */
create function public.add_members_internal(
  p_conversation_id uuid,
  p_user_ids uuid[],
  p_added_by uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added uuid[];
begin
  with inserted as (
    insert into public.conversation_members (conversation_id, user_id, added_by)
    select p_conversation_id, p.id, p_added_by
      from public.profiles p
     where p.id = any (p_user_ids) and p.employment_status = 'active'
    on conflict do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into v_added from inserted;

  -- New members start with everything already sent marked as read.
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  select p_conversation_id, u, now() from unnest(v_added) u
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

  return v_added;
end;
$$;

revoke execute on function public.add_members_internal from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

create policy "conversations: members read"
  on public.conversations for select to authenticated
  using ((select public.is_active_user()) and public.is_conversation_member(id));

create policy "conversation_members: members read"
  on public.conversation_members for select to authenticated
  using ((select public.is_active_user()) and public.is_conversation_member(conversation_id));

create policy "messages: members read"
  on public.messages for select to authenticated
  using ((select public.is_active_user()) and public.is_conversation_member(conversation_id));

create policy "messages: members send as themselves"
  on public.messages for insert to authenticated
  with check (
    (select public.is_active_user())
    and sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
  );

create policy "conversation_reads: members read"
  on public.conversation_reads for select to authenticated
  using ((select public.is_active_user()) and public.is_conversation_member(conversation_id));

-- No insert/update/delete policies otherwise: the functions below write.
revoke update, delete on public.messages from authenticated;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

/** Server time, and an attachment must already be uploaded. */
create function public.messages_before_insert()
returns trigger
language plpgsql
security definer -- reads storage.objects
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

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

/** Bumps the conversation, marks it read for the sender, notifies everyone else. */
create function public.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.conversations;
  v_sender text;
  v_recipients uuid[];
  v_text text;
begin
  update public.conversations set last_message_at = new.created_at
   where id = new.conversation_id
  returning * into v_conversation;

  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (new.conversation_id, new.sender_id, new.created_at)
  on conflict (conversation_id, user_id)
  do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);

  select coalesce(array_agg(m.user_id), '{}') into v_recipients
    from public.conversation_members m
   where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id;

  if cardinality(v_recipients) > 0 then
    select coalesce(nullif(btrim(p.full_name), ''), 'Someone') into v_sender
      from public.profiles p where p.id = new.sender_id;
    v_text := coalesce(left(new.body, 200), '📷 Photo');
    perform public.notify_users(
      v_recipients,
      'message',
      case when v_conversation.type = 'group' then v_conversation.name else v_sender end,
      case when v_conversation.type = 'group' then v_sender || ': ' || v_text else v_text end,
      jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id),
      'message:' || new.id
    );
  end if;
  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ---------------------------------------------------------------------------
-- Starting conversations and managing members
-- ---------------------------------------------------------------------------

/**
 * Opens (or creates) the 1:1 chat with p_user_id and returns its id.
 * Admins and supervisors: with any active user. Officers: with active supervisors.
 */
create function public.start_direct_conversation(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_other public.profiles;
  v_key text;
  v_id uuid;
begin
  if not public.is_active_user() or v_uid is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'Choose someone else to message' using errcode = '22023';
  end if;

  select * into v_other from public.profiles where id = p_user_id;
  if v_other.id is null or v_other.employment_status <> 'active' then
    raise exception 'This person can''t receive messages' using errcode = 'P0001';
  end if;
  if not coalesce(v_role in ('admin', 'supervisor'), false) and v_other.role <> 'supervisor' then
    raise exception 'Officers can start chats with supervisors only' using errcode = '42501';
  end if;

  v_key := least(v_uid::text, p_user_id::text) || ':' || greatest(v_uid::text, p_user_id::text);

  insert into public.conversations (type, direct_key, created_by)
  values ('direct', v_key, v_uid)
  on conflict (direct_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.conversations where direct_key = v_key;
  end if;

  perform public.add_members_internal(v_id, array[v_uid, p_user_id], v_uid);
  return v_id;
end;
$$;

/**
 * Creates a group (admins and supervisors). The creator is always a member. With
 * p_site_id, everyone assigned to that site joins now, and later assignments and
 * unassignments keep the group in step.
 */
create function public.create_group_conversation(
  p_name text,
  p_member_ids uuid[] default '{}',
  p_site_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_members uuid[];
  v_added uuid[];
  v_creator text;
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'Give the group a name (up to 100 characters)' using errcode = '22023';
  end if;
  if p_site_id is not null and not exists (select 1 from public.sites where id = p_site_id) then
    raise exception 'Site not found' using errcode = 'P0001';
  end if;

  insert into public.conversations (type, name, site_id, created_by)
  values ('group', v_name, p_site_id, v_uid)
  returning id into v_id;

  v_members := array[v_uid] || coalesce(p_member_ids, '{}');
  if p_site_id is not null then
    v_members := v_members || array(
      select a.officer_id from public.site_assignments a where a.site_id = p_site_id
    );
  end if;
  v_added := public.add_members_internal(v_id, v_members, v_uid);

  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_creator
    from public.profiles where id = v_uid;
  perform public.notify_users(
    array_remove(v_added, v_uid), 'message', v_name, v_creator || ' added you to this group',
    jsonb_build_object('conversation_id', v_id), 'conversation-added:' || v_id
  );
  return v_id;
end;
$$;

/** Staff who are in the group add people to it. Returns how many joined. */
create function public.add_conversation_members(p_conversation_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation public.conversations;
  v_added uuid[];
  v_by text;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not public.is_staff() or v_conversation.id is null
     or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_conversation.type <> 'group' then
    raise exception 'People can only be added to groups' using errcode = 'P0001';
  end if;

  v_added := public.add_members_internal(p_conversation_id, coalesce(p_user_ids, '{}'), v_uid);

  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_by
    from public.profiles where id = v_uid;
  perform public.notify_users(
    v_added, 'message', v_conversation.name, v_by || ' added you to this group',
    jsonb_build_object('conversation_id', p_conversation_id),
    'conversation-added:' || p_conversation_id
  );
  return cardinality(v_added);
end;
$$;

/** Staff in the group remove someone; anyone may remove themselves (leave). Groups only. */
create function public.remove_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_type public.conversation_type;
begin
  select type into v_type from public.conversations where id = p_conversation_id;
  if not public.is_active_user() or v_type is null
     or not public.is_conversation_member(p_conversation_id)
     or (p_user_id is distinct from v_uid and not public.is_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_type <> 'group' then
    raise exception 'You can''t leave a 1:1 chat' using errcode = 'P0001';
  end if;
  delete from public.conversation_members
   where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$$;

/** Read receipt: the caller has read everything in this conversation so far. */
create function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_active_user() or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading (names come from here: officers can't read other profiles)
-- ---------------------------------------------------------------------------

/**
 * The caller's conversations, latest activity first, with a display title (the
 * group name, or the other person's name), the last message and the unread count.
 */
create function public.list_conversations()
returns table (
  id uuid,
  type public.conversation_type,
  title text,
  site_id uuid,
  other_user_id uuid,
  other_user_role public.user_role,
  member_count integer,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid,
  unread_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.type,
    case when c.type = 'group' then c.name else coalesce(o.full_name, 'Former colleague') end,
    c.site_id,
    o.id,
    o.role,
    (select count(*)::integer from public.conversation_members m2 where m2.conversation_id = c.id),
    c.last_message_at,
    lm.preview,
    lm.sender_id,
    (select count(*)::integer from public.messages x
      where x.conversation_id = c.id
        and x.sender_id <> me.user_id
        and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
    c.created_at
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = me.user_id
  -- The other person in a 1:1 chat, from direct_key (still named after they leave).
  left join lateral (
    select p.id, p.full_name, p.role from public.profiles p
     where c.type = 'direct'
       and p.id <> me.user_id
       and p.id::text = any (string_to_array(c.direct_key, ':'))
  ) o on true
  left join lateral (
    select coalesce(left(x.body, 140), '📷 Photo') as preview, x.sender_id
      from public.messages x
     where x.conversation_id = c.id
     order by x.created_at desc, x.id desc
     limit 1
  ) lm on true
  where me.user_id = auth.uid() and public.is_active_user()
  order by coalesce(c.last_message_at, c.created_at) desc
$$;

/**
 * Everyone who appears in a conversation: current members (with their read
 * receipt) and past senders who have since left. Members only.
 */
create function public.conversation_people(p_conversation_id uuid)
returns table (
  user_id uuid,
  full_name text,
  role public.user_role,
  is_member boolean,
  last_read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_active_user() or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select
    p.id,
    p.full_name,
    p.role,
    m.user_id is not null,
    case when m.user_id is not null then r.last_read_at end
  from (
    select cm.user_id as uid from public.conversation_members cm
     where cm.conversation_id = p_conversation_id
    union
    select distinct x.sender_id from public.messages x where x.conversation_id = p_conversation_id
  ) u
  join public.profiles p on p.id = u.uid
  left join public.conversation_members m
    on m.conversation_id = p_conversation_id and m.user_id = u.uid
  left join public.conversation_reads r
    on r.conversation_id = p_conversation_id and r.user_id = u.uid
  order by p.full_name;
end;
$$;

/**
 * People the caller may start a 1:1 chat with (or add to a group, for staff):
 * staff see every other active user, officers see active supervisors.
 */
create function public.chat_contacts()
returns table (user_id uuid, full_name text, role public.user_role)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role
    from public.profiles p
   where public.is_active_user()
     and p.id <> auth.uid()
     and p.employment_status = 'active'
     and (public.is_staff() or p.role = 'supervisor')
   order by p.full_name
$$;

-- ---------------------------------------------------------------------------
-- Keeping membership right
-- ---------------------------------------------------------------------------

/** Terminated users leave every conversation (their past messages stay). */
create function public.remove_terminated_from_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.employment_status = 'terminated' and old.employment_status is distinct from 'terminated' then
    delete from public.conversation_members where user_id = new.id;
  end if;
  return null;
end;
$$;

create trigger profiles_remove_terminated_from_conversations
  after update of employment_status on public.profiles
  for each row execute function public.remove_terminated_from_conversations();

/** Site groups follow the site's assignments. */
create function public.sync_site_group_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.add_members_internal(c.id, array[new.officer_id], null)
       from public.conversations c where c.site_id = new.site_id and c.type = 'group';
  else
    delete from public.conversation_members m
     using public.conversations c
     where c.id = m.conversation_id and c.site_id = old.site_id and m.user_id = old.officer_id;
  end if;
  return null;
end;
$$;

create trigger site_assignments_sync_site_groups
  after insert or delete on public.site_assignments
  for each row execute function public.sync_site_group_members();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.messages_before_insert from public, anon, authenticated;
revoke execute on function public.messages_after_insert from public, anon, authenticated;
revoke execute on function public.remove_terminated_from_conversations from public, anon, authenticated;
revoke execute on function public.sync_site_group_members from public, anon, authenticated;

revoke execute on function public.is_conversation_member from public, anon;
revoke execute on function public.is_conversation_folder_member from public, anon;
revoke execute on function public.is_staff from public, anon;
revoke execute on function public.start_direct_conversation from public, anon;
revoke execute on function public.create_group_conversation from public, anon;
revoke execute on function public.add_conversation_members from public, anon;
revoke execute on function public.remove_conversation_member from public, anon;
revoke execute on function public.mark_conversation_read from public, anon;
revoke execute on function public.list_conversations from public, anon;
revoke execute on function public.conversation_people from public, anon;
revoke execute on function public.chat_contacts from public, anon;

grant execute on function public.is_conversation_member to authenticated;
grant execute on function public.is_conversation_folder_member to authenticated;
grant execute on function public.is_staff to authenticated;
grant execute on function public.start_direct_conversation to authenticated;
grant execute on function public.create_group_conversation to authenticated;
grant execute on function public.add_conversation_members to authenticated;
grant execute on function public.remove_conversation_member to authenticated;
grant execute on function public.mark_conversation_read to authenticated;
grant execute on function public.list_conversations to authenticated;
grant execute on function public.conversation_people to authenticated;
grant execute on function public.chat_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private `chat-attachments` bucket
-- Path: <conversation_id>/<sender_id>/<random>.<ext>. Members of the
-- conversation read; members upload only into their own folder of it.
-- The phone re-encodes photos as JPEG (no EXIF/GPS); the console sends what
-- the browser picked (JPEG, PNG or WebP).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp']);

create policy "chat-attachments: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (select public.is_active_user())
    and public.is_conversation_folder_member((storage.foldername(name))[1])
  );

create policy "chat-attachments: members upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (select public.is_active_user())
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_conversation_folder_member((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages, public.conversation_reads;
