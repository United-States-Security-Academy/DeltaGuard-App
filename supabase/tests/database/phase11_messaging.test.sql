-- Phase 11 tests: messaging (conversations, members, messages, read receipts,
-- attachments, notifications, terminated users, site groups). Run with: pnpm db:test
--
-- Conversation ids are created by the functions, so they are kept in session
-- settings (p11.*) between statements.
begin;

set local role postgres;
set local timezone = 'UTC';

create extension if not exists pgtap with schema extensions;

select set_config(
  'search_path',
  current_setting('search_path') || ', '
    || (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap'),
  true
);

select plan(54);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000b00a1', 'p11.a@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P11 Officer A"}'),
  ('00000000-0000-0000-0000-0000000b00a2', 'p11.b@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P11 Officer B"}'),
  ('00000000-0000-0000-0000-0000000b00a3', 'p11.c@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P11 Officer C"}'),
  ('00000000-0000-0000-0000-0000000b00a4', 'p11.t@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P11 Officer T"}'),
  ('00000000-0000-0000-0000-0000000b00e1', 'p11.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P11 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000b00e2', 'p11.sup2@test.local', '{"role":"supervisor","employment_status":"suspended"}', '{"full_name":"P11 Suspended Supervisor"}'),
  ('00000000-0000-0000-0000-0000000b00f1', 'p11.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P11 Admin"}');

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000b00c1', 'P11 Client');
insert into public.sites (id, client_id, name) values
  ('00000000-0000-0000-0000-0000000b0051', '00000000-0000-0000-0000-0000000b00c1', 'P11 Site');
insert into public.site_assignments (site_id, officer_id) values
  ('00000000-0000-0000-0000-0000000b0051', '00000000-0000-0000-0000-0000000b00a1'),
  ('00000000-0000-0000-0000-0000000b0051', '00000000-0000-0000-0000-0000000b00a2');

create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
      'user_id', uid,
      'claims', jsonb_build_object('sub', uid, 'role', 'authenticated')
    )) -> 'claims')::text,
    true
  );
$$;

create function pg_temp.id(name text) returns uuid language sql as $$
  select nullif(current_setting('p11.' || name, true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.conversations'::regclass, 'public.conversation_members'::regclass,
                  'public.messages'::regclass, 'public.conversation_reads'::regclass)),
  'RLS is enabled on every messaging table'
);
select ok(
  (select count(*) = 2 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('messages', 'conversation_reads')),
  'messages and read receipts are published to Realtime'
);
select ok(not has_function_privilege('anon', 'public.list_conversations()', 'execute'),
  'anon cannot list conversations');

-- ---------------------------------------------------------------------------
-- Direct chats
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00a1');
set local role authenticated;

select set_config('p11.direct',
  public.start_direct_conversation('00000000-0000-0000-0000-0000000b00e1')::text, true);
select isnt(pg_temp.id('direct'), null, 'an officer can start a 1:1 chat with a supervisor');
select is(
  public.start_direct_conversation('00000000-0000-0000-0000-0000000b00e1'),
  pg_temp.id('direct'),
  'starting it again opens the same chat'
);
select throws_ok(
  $$ select public.start_direct_conversation('00000000-0000-0000-0000-0000000b00a2') $$,
  '42501', 'Officers can start chats with supervisors only',
  'an officer cannot start a chat with another officer'
);
select throws_ok(
  $$ select public.start_direct_conversation('00000000-0000-0000-0000-0000000b00f1') $$,
  '42501', 'Officers can start chats with supervisors only',
  'an officer cannot start a chat with an admin'
);
select throws_ok(
  $$ select public.start_direct_conversation('00000000-0000-0000-0000-0000000b00a1') $$,
  '22023', null,
  'nobody can start a chat with themselves'
);
select throws_ok(
  $$ select public.start_direct_conversation('00000000-0000-0000-0000-0000000b00e2') $$,
  'P0001', 'This person can''t receive messages',
  'nobody can start a chat with a suspended user'
);
select throws_ok(
  $$ insert into public.conversations (type, name) values ('group', 'Sneaky') $$,
  '42501', null,
  'conversations cannot be created directly'
);
select throws_ok(
  $$ insert into public.conversation_members (conversation_id, user_id)
     values (pg_temp.id('direct'), '00000000-0000-0000-0000-0000000b00a2') $$,
  '42501', null,
  'members cannot be added directly'
);

select ok(
  (select bool_and(role = 'supervisor')
          and bool_or(user_id = '00000000-0000-0000-0000-0000000b00e1')
          and not bool_or(user_id = '00000000-0000-0000-0000-0000000b00e2')
     from public.chat_contacts()),
  'an officer''s contacts are the active supervisors only'
);

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

-- now() is the same all through this transaction, so the supervisor would have
-- "read" everything sent in it; put their read receipt an hour back.
set local role postgres;
update public.conversation_reads set last_read_at = now() - interval '1 hour'
 where conversation_id = pg_temp.id('direct') and user_id = '00000000-0000-0000-0000-0000000b00e1';
set local role authenticated;

select lives_ok(
  $$ insert into public.messages (id, conversation_id, sender_id, body, created_at)
     values ('00000000-0000-0000-0000-0000000b1001', pg_temp.id('direct'),
             '00000000-0000-0000-0000-0000000b00a1', 'Gate 2 is locked, who has the key?',
             '2000-01-01') $$,
  'a member sends a message'
);
select ok(
  (select created_at > now() - interval '1 minute' from public.messages
    where id = '00000000-0000-0000-0000-0000000b1001'),
  'created_at is always server time'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, body)
     values (pg_temp.id('direct'), '00000000-0000-0000-0000-0000000b00e1', 'Pretending') $$,
  '42501', null,
  'nobody can send as someone else'
);
select throws_ok(
  $$ update public.messages set body = 'edited' where id = '00000000-0000-0000-0000-0000000b1001' $$,
  '42501', null,
  'messages cannot be edited'
);
select throws_ok(
  $$ delete from public.messages where id = '00000000-0000-0000-0000-0000000b1001' $$,
  '42501', null,
  'messages cannot be deleted'
);
set local role postgres;
-- A file outside the conversation's folder (only possible as postgres), so the
-- folder rule itself is what rejects the message below.
insert into storage.objects (bucket_id, name) values ('chat-attachments', 'elsewhere/x.jpg');
set local role authenticated;
select throws_ok(
  format($$ insert into public.messages (conversation_id, sender_id, attachment_path)
            values (%L, '00000000-0000-0000-0000-0000000b00a1', 'elsewhere/x.jpg') $$,
         pg_temp.id('direct')),
  '23514', null,
  'an attachment must be in this conversation''s folder, under the sender'
);
select throws_ok(
  format($$ insert into public.messages (conversation_id, sender_id, attachment_path)
            values (%L, '00000000-0000-0000-0000-0000000b00a1', %L) $$,
         pg_temp.id('direct'), pg_temp.id('direct') || '/00000000-0000-0000-0000-0000000b00a1/missing.jpg'),
  'P0001', 'The photo hasn''t finished uploading',
  'an attachment must be uploaded before the message is sent'
);

-- Storage: members upload into their own folder of the conversation only.
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name)
            values ('chat-attachments', %L) $$,
         pg_temp.id('direct') || '/00000000-0000-0000-0000-0000000b00a1/photo.jpg'),
  'a member uploads into their own folder of the conversation'
);
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name)
            values ('chat-attachments', %L) $$,
         pg_temp.id('direct') || '/00000000-0000-0000-0000-0000000b00e1/photo.jpg'),
  '42501', null,
  'nobody uploads into someone else''s folder'
);
select lives_ok(
  format($$ insert into public.messages (conversation_id, sender_id, attachment_path)
            values (%L, '00000000-0000-0000-0000-0000000b00a1', %L) $$,
         pg_temp.id('direct'), pg_temp.id('direct') || '/00000000-0000-0000-0000-0000000b00a1/photo.jpg'),
  'a photo message is sent once the photo is uploaded'
);

-- ---------------------------------------------------------------------------
-- Notifications, unread counts, read receipts
-- ---------------------------------------------------------------------------

set local role postgres;

select is(
  (select count(*)::integer from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000b00e1' and type = 'message'
      and data ->> 'conversation_id' = pg_temp.id('direct')::text),
  2,
  'the other member is notified of each message'
);
select is(
  (select count(*)::integer from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000b00a1' and type = 'message'),
  0,
  'the sender is not notified'
);
select is(
  (select title from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000b00e1' and dedupe_key = 'message:00000000-0000-0000-0000-0000000b1001'),
  'P11 Officer A',
  'a 1:1 message notification is titled with the sender''s name'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00e1');
set local role authenticated;

select results_eq(
  format($$ select title, unread_count, other_user_id from public.list_conversations() where id = %L $$,
         pg_temp.id('direct')),
  $$ values ('P11 Officer A'::text, 2, '00000000-0000-0000-0000-0000000b00a1'::uuid) $$,
  'the supervisor sees the chat titled with the officer''s name and 2 unread'
);
select is(
  public.start_direct_conversation('00000000-0000-0000-0000-0000000b00a1'),
  pg_temp.id('direct'),
  'the supervisor starting a chat with the officer opens the same one'
);
select lives_ok(
  format($$ select public.mark_conversation_read(%L) $$, pg_temp.id('direct')),
  'a member marks the chat read'
);
select is(
  (select unread_count from public.list_conversations() where id = pg_temp.id('direct')),
  0,
  'nothing unread after marking it read'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00a1');
set local role authenticated;

select ok(
  (select last_read_at is not null from public.conversation_people(pg_temp.id('direct'))
    where user_id = '00000000-0000-0000-0000-0000000b00e1'),
  'the sender sees the supervisor''s read receipt'
);

-- ---------------------------------------------------------------------------
-- Outsiders
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00a2');
set local role authenticated;

select is(
  (select count(*)::integer from public.messages where conversation_id = pg_temp.id('direct')),
  0,
  'a non-member reads no messages'
);
select is(
  (select count(*)::integer from public.list_conversations() where id = pg_temp.id('direct')),
  0,
  'a non-member doesn''t see the conversation'
);
select throws_ok(
  format($$ insert into public.messages (conversation_id, sender_id, body)
            values (%L, '00000000-0000-0000-0000-0000000b00a2', 'Hi') $$,
         pg_temp.id('direct')),
  '42501', null,
  'a non-member cannot send'
);
select throws_ok(
  format($$ select * from public.conversation_people(%L) $$, pg_temp.id('direct')),
  '42501', 'Not allowed',
  'a non-member cannot list the people in a conversation'
);
select is(
  (select count(*)::integer from storage.objects
    where bucket_id = 'chat-attachments' and name like pg_temp.id('direct') || '/%'),
  0,
  'a non-member cannot see the conversation''s attachments'
);
select throws_ok(
  $$ select public.create_group_conversation('Officers only') $$,
  '42501', 'Not allowed',
  'an officer cannot create a group'
);

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00e1');
set local role authenticated;

select set_config('p11.group',
  public.create_group_conversation('Night team', array[
    '00000000-0000-0000-0000-0000000b00a1'::uuid, '00000000-0000-0000-0000-0000000b00a4'::uuid,
    '00000000-0000-0000-0000-0000000b00e2'::uuid -- suspended: skipped
  ])::text, true);
select results_eq(
  format($$ select user_id from public.conversation_members where conversation_id = %L order by user_id $$,
         pg_temp.id('group')),
  $$ values ('00000000-0000-0000-0000-0000000b00a1'::uuid), ('00000000-0000-0000-0000-0000000b00a4'::uuid),
            ('00000000-0000-0000-0000-0000000b00e1'::uuid) $$,
  'a supervisor creates a group: the creator and the active people chosen'
);
select throws_ok(
  $$ select public.create_group_conversation('   ') $$,
  '22023', null,
  'a group needs a name'
);
select is(
  public.add_conversation_members(pg_temp.id('group'), array['00000000-0000-0000-0000-0000000b00a2'::uuid]),
  1,
  'a supervisor in the group adds someone'
);

set local role postgres;
select is(
  (select count(*)::integer from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000b00a2'
      and dedupe_key = 'conversation-added:' || pg_temp.id('group')),
  1,
  'the person added is notified'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00a1');
set local role authenticated;

select throws_ok(
  format($$ select public.add_conversation_members(%L, array['00000000-0000-0000-0000-0000000b00a3'::uuid]) $$,
         pg_temp.id('group')),
  '42501', 'Not allowed',
  'an officer cannot add people'
);
select throws_ok(
  format($$ select public.remove_conversation_member(%L, '00000000-0000-0000-0000-0000000b00a2') $$,
         pg_temp.id('group')),
  '42501', 'Not allowed',
  'an officer cannot remove someone else'
);
select lives_ok(
  format($$ insert into public.messages (conversation_id, sender_id, body)
            values (%L, '00000000-0000-0000-0000-0000000b00a1', 'On my way') $$,
         pg_temp.id('group')),
  'a member posts in the group'
);
select lives_ok(
  format($$ select public.remove_conversation_member(%L, '00000000-0000-0000-0000-0000000b00a1') $$,
         pg_temp.id('group')),
  'an officer leaves a group'
);
select is(
  (select count(*)::integer from public.messages where conversation_id = pg_temp.id('group')),
  0,
  'after leaving, the group''s messages are no longer readable'
);
select throws_ok(
  format($$ select public.remove_conversation_member(%L, '00000000-0000-0000-0000-0000000b00a1') $$,
         pg_temp.id('direct')),
  'P0001', 'You can''t leave a 1:1 chat',
  'a 1:1 chat cannot be left'
);

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00e1');
set local role authenticated;

select ok(
  (select not is_member and full_name = 'P11 Officer A'
     from public.conversation_people(pg_temp.id('group'))
    where user_id = '00000000-0000-0000-0000-0000000b00a1'),
  'someone who left still has a name on their old messages'
);

-- Site groups follow site assignments.
set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00f1');
set local role authenticated;

select set_config('p11.site_group',
  public.create_group_conversation('P11 Site team', '{}', '00000000-0000-0000-0000-0000000b0051')::text, true);

set local role postgres;
select results_eq(
  format($$ select user_id from public.conversation_members where conversation_id = %L order by user_id $$,
         pg_temp.id('site_group')),
  $$ values ('00000000-0000-0000-0000-0000000b00a1'::uuid), ('00000000-0000-0000-0000-0000000b00a2'::uuid),
            ('00000000-0000-0000-0000-0000000b00f1'::uuid) $$,
  'a site group starts with everyone assigned to the site'
);

insert into public.site_assignments (site_id, officer_id)
values ('00000000-0000-0000-0000-0000000b0051', '00000000-0000-0000-0000-0000000b00a3');
select ok(
  exists (select 1 from public.conversation_members
           where conversation_id = pg_temp.id('site_group')
             and user_id = '00000000-0000-0000-0000-0000000b00a3'),
  'assigning an officer to the site adds them to its group'
);

delete from public.site_assignments
 where site_id = '00000000-0000-0000-0000-0000000b0051'
   and officer_id = '00000000-0000-0000-0000-0000000b00a3';
select ok(
  not exists (select 1 from public.conversation_members
               where conversation_id = pg_temp.id('site_group')
                 and user_id = '00000000-0000-0000-0000-0000000b00a3'),
  'unassigning them removes them from the group'
);

-- ---------------------------------------------------------------------------
-- Terminated and suspended users
-- ---------------------------------------------------------------------------

insert into public.messages (conversation_id, sender_id, body)
values (pg_temp.id('group'), '00000000-0000-0000-0000-0000000b00a4', 'Signing off');

update public.profiles set employment_status = 'terminated'
 where id = '00000000-0000-0000-0000-0000000b00a4';

select is(
  (select count(*)::integer from public.conversation_members
    where user_id = '00000000-0000-0000-0000-0000000b00a4'),
  0,
  'a terminated user is removed from every conversation'
);
select is(
  (select count(*)::integer from public.messages
    where sender_id = '00000000-0000-0000-0000-0000000b00a4'),
  1,
  'their past messages stay'
);

-- The suspended supervisor was never added; make them a member, then check
-- that being suspended still hides everything.
insert into public.conversation_members (conversation_id, user_id)
values (pg_temp.id('group'), '00000000-0000-0000-0000-0000000b00e2');

set local role postgres;
select pg_temp.login_as('00000000-0000-0000-0000-0000000b00e2');
set local role authenticated;

select is(
  (select count(*)::integer from public.messages where conversation_id = pg_temp.id('group')),
  0,
  'a suspended member reads nothing'
);
select is(
  (select count(*)::integer from public.list_conversations()),
  0,
  'a suspended member lists no conversations'
);

select * from finish();
rollback;
