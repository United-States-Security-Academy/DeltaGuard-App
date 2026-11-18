-- LOCAL DEVELOPMENT ONLY. Runs on `pnpm supabase db reset` against the local
-- Docker stack. It never runs against the hosted dev/prod projects.
--
-- Creates the first admin, who can sign in with:
--   email:    admin@deltaguard.local
--   password: ChangeMe-Local-123!
-- Edit the values below if you want different local credentials.

do $$
declare
  admin_id uuid := '00000000-0000-0000-0000-00000000ad01';
  admin_email text := 'admin@deltaguard.local';
  admin_password text := 'ChangeMe-Local-123!';
  admin_name text := 'Local Admin';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, email_change, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', admin_id, 'authenticated', 'authenticated',
    admin_email, extensions.crypt(admin_password, extensions.gen_salt('bf')), now(),
    -- role lives in app_metadata; the on_auth_user_created trigger copies it to profiles.
    jsonb_build_object(
      'provider', 'email', 'providers', jsonb_build_array('email'),
      'role', 'admin', 'employment_status', 'active'
    ),
    jsonb_build_object('full_name', admin_name), now(), now(),
    '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), admin_id, admin_id::text, 'email',
    jsonb_build_object('sub', admin_id::text, 'email', admin_email, 'email_verified', true),
    now(), now(), now()
  );
end;
$$;
