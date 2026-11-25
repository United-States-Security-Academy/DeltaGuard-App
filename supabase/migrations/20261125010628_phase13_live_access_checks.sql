-- Phase 13: access ends the moment an admin changes it.
--
-- Problem: is_active_user() and auth_role() read only the JWT. Suspending,
-- terminating or demoting someone deletes their sessions and bans them, but an
-- access token already issued stays valid until it expires (jwt_expiry, 1 h).
-- Until then the old claims kept working everywhere RLS applies: the API,
-- Realtime and Storage.
--
-- Fix: both functions now also check the caller's live profile row.
--   is_active_user(): JWT says active AND profiles.employment_status = 'active'.
--   auth_role():      the JWT role, only while it still matches profiles.role
--                     (null otherwise, so no role-based policy matches).
-- They become SECURITY DEFINER so they can read profiles without going through
-- profiles' own RLS policies (which call these functions). They only ever read
-- the caller's own row, by primary key. Every policy already calls them as
-- `(select public.is_active_user())`, which Postgres evaluates once per
-- statement, so the extra lookup is one index read per query.
--
-- Signatures are unchanged, so existing grants and policies keep working.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.jwt() ->> 'employment_status' = 'active'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.employment_status = 'active'
    ),
    false
  )
$$;

comment on function public.is_active_user() is
  'True when the employment_status JWT claim is active and the caller''s profile is still active (checked live, so suspension takes effect at once).';

create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = auth.uid()
     and p.role::text = auth.jwt() ->> 'user_role'
$$;

comment on function public.auth_role() is
  'Role from the user_role JWT claim, only while it still matches the caller''s profile (checked live, so a role change takes effect at once).';
