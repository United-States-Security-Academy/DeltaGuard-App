-- Phase 11c: 1:1 chat titles for people with no name.
--
-- list_conversations() titled a direct chat "Former colleague" whenever the
-- other person's full_name was null, so a chat with an admin whose profile has
-- no name looked like a chat with someone who had left. Now:
--   - a blank name falls back to the person's role ("Admin", "Supervisor",
--     "Officer");
--   - "Former colleague" only when their profile no longer exists.
-- Same signature, so existing grants (authenticated only) are kept.

create or replace function public.list_conversations()
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
    case
      when c.type = 'group' then c.name
      when o.id is null then 'Former colleague'
      else coalesce(nullif(btrim(o.full_name), ''), initcap(o.role::text))
    end,
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
