-- Phase 11b: table privileges for messaging.
--
-- This project doesn't grant new tables to API roles automatically (see the
-- explicit grants in earlier phases), so phase 11's tables were unreachable.
-- RLS still decides which rows: members read their conversations, and members
-- insert messages as themselves. Nothing else is writable through the API;
-- conversations, members and read receipts change only via the functions.

grant select on public.conversations, public.conversation_members, public.conversation_reads
  to authenticated;
grant select, insert on public.messages to authenticated;

grant all on public.conversations, public.conversation_members, public.messages,
  public.conversation_reads to service_role;
