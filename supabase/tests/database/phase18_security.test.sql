-- Phase 18 tests: the security audit's findings, so none can come back.
-- Catalog checks cover every table / function / bucket (new ones included);
-- behaviour checks prove the guards work. Run with: pnpm db:test
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

select plan(70);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000018a1', 'p18.o1@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P18 Officer One"}'),
  ('00000000-0000-0000-0000-0000000018a2', 'p18.o2@test.local', '{"role":"officer","employment_status":"active"}', '{"full_name":"P18 Officer Two"}'),
  ('00000000-0000-0000-0000-0000000018e1', 'p18.sup@test.local', '{"role":"supervisor","employment_status":"active"}', '{"full_name":"P18 Supervisor"}'),
  ('00000000-0000-0000-0000-0000000018f1', 'p18.admin@test.local', '{"role":"admin","employment_status":"active"}', '{"full_name":"P18 Admin"}');

insert into public.user_devices (user_id, device_id, platform) values
  ('00000000-0000-0000-0000-0000000018a1', 'p18-phone-1', 'ios');

insert into public.notifications (id, user_id, type, title, body) values
  ('00000000-0000-0000-0000-00000018b001', '00000000-0000-0000-0000-0000000018a1', 'test', 'Hello', 'World');

create function pg_temp.login_as(uid uuid) returns void language sql security definer as $$
  select set_config(
    'request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
      'user_id', uid,
      'claims', jsonb_build_object('sub', uid, 'role', 'authenticated')
    )) -> 'claims')::text,
    true
  );
$$;

-- Tables in public (not views).
create temp view _tables as
  select c.oid, c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');

-- Functions we own in public (not from extensions).
create temp view _functions as
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prorettype, p.proacl, p.proowner
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and pg_get_userbyid(p.proowner) = 'postgres'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

grant select on _tables, _functions to authenticated;

-- ---------------------------------------------------------------------------
-- RLS and policies
-- ---------------------------------------------------------------------------

select is(
  (select string_agg(t.relname, ', ') from _tables t join pg_class c on c.oid = t.oid where not c.relrowsecurity),
  null,
  'every table in public has RLS enabled'
);

select is(
  (select string_agg(t.relname, ', ') from _tables t
    where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname)),
  null,
  'every table in public has at least one explicit policy'
);

select is(
  (select string_agg(tablename || '.' || policyname, ', ') from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') ~* '^[\s(]*true[\s)]*$' or coalesce(with_check, '') ~* '^[\s(]*true[\s)]*$')),
  null,
  'no policy allows everything with USING (true) or WITH CHECK (true)'
);

select is(
  (select string_agg(tablename || '.' || policyname, ', ') from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'user_metadata|raw_user_meta_data'),
  null,
  'no policy trusts user_metadata'
);

select is(
  (select string_agg(tablename || '.' || policyname, ', ') from pg_policies
    where schemaname in ('public', 'storage') and roles && array['anon', 'public']::name[]),
  null,
  'no policy is granted to anon or public'
);

select is(
  (select string_agg(tablename || '.' || policyname, ', ') from pg_policies
    where schemaname = 'public' and cmd = 'SELECT'
      and coalesce(qual, '') !~ '(is_active_user|is_staff|can_manage_welfare_check|can_see_sos|lesson_visible_to_me|is_conversation_member|supervises_|false)'),
  null,
  'every read policy in public requires an active user'
);

-- Tables officers must never write directly: any write policy is admin-only (or none).
select is(
  (select string_agg(tablename || '.' || policyname, ', ') from pg_policies
    where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and tablename in ('attendance_events', 'timesheet_entries', 'timesheet_corrections', 'incidents',
                        'incident_status_history', 'incident_photos', 'welfare_checks', 'welfare_pauses',
                        'welfare_outbox', 'device_heartbeats', 'assessment_attempts', 'lesson_progress',
                        'assessment_attempt_grants', 'sos_alerts', 'sos_events', 'sos_locations',
                        'daily_activity_reports', 'post_order_acknowledgements', 'audit_log', 'pay_periods',
                        'questions', 'question_options', 'form_fields', 'form_template_versions')
      and (coalesce(qual, '') || coalesce(with_check, '')) !~ '''admin''|false'),
  null,
  'statuses, scores, flags and review fields live in tables only admins can write directly'
);

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------

select is(
  (select string_agg(relname, ', ') from _tables
    where has_table_privilege('anon', oid, 'select, insert, update, delete, truncate, references, trigger')),
  null,
  'anon has no privilege at all on any table in public'
);

select is(
  (select string_agg(relname, ', ') from _tables
    where has_table_privilege('authenticated', oid, 'truncate, references, trigger')),
  null,
  'authenticated has no TRUNCATE / REFERENCES / TRIGGER on any table (TRUNCATE ignores RLS)'
);

select is(
  (select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
      and (a.grantee = 'anon'::regrole
           or (a.grantee = 'authenticated'::regrole and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
           or (d.defaclobjtype = 'f' and a.grantee = 0))),
  0,
  'new tables and functions made by migrations don''t grant anon (or PUBLIC) anything'
);

select is(
  (select string_agg(c.relname, ', ') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  null,
  'every view in public uses security_invoker = true'
);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

select is(
  (select string_agg(proname, ', ') from _functions
    where prosecdef and not exists (select 1 from unnest(proconfig) c where c like 'search_path=%')),
  null,
  'every SECURITY DEFINER function sets search_path'
);

select is(
  (select string_agg(proname, ', ') from _functions where has_function_privilege('anon', oid, 'execute')),
  null,
  'anon can execute no function in public'
);

select is(
  (select string_agg(proname, ', ') from _functions
    where exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a
                   where a.grantee = 0 and a.privilege_type = 'EXECUTE')),
  null,
  'no function in public is executable by PUBLIC'
);

select is(
  (select string_agg(proname, ', ') from _functions
    where prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
      and has_function_privilege('authenticated', oid, 'execute')),
  null,
  'trigger functions can''t be called through the API'
);

-- A SECURITY DEFINER function the API can call must check the caller is an
-- active user (directly or through a helper that does). Reviewed exceptions:
-- auth_role / is_active_user ARE the checks; the others are only called from
-- policies that check the user, or start with assessment_gate().
select is(
  (select string_agg(proname, ', ') from _functions
    where prosecdef and prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', oid, 'execute')
      and pg_get_functiondef(oid) !~ '(is_active_user|is_staff|can_manage_welfare_check|lesson_visible_to_me|can_see_sos|is_conversation_member|assessment_gate|form_template_visible_to_me|supervises_form_submission)\('
      and proname not in ('auth_role', 'is_active_user', 'can_upload_form_submission_file', 'is_locked_date',
                          'storage_upload_allowed')),
  null,
  'every API-callable SECURITY DEFINER function checks the caller is an active user'
);

select ok(
  pg_get_functiondef('public.effective_max_attempts(public.assessments, uuid)'::regprocedure)
    ~ 'not \(public.is_staff\(\) or p_officer = auth.uid\(\)\) then 0',
  'effective_max_attempts answers only staff, or an officer about themselves'
);

select ok(
  not has_function_privilege('authenticated', 'public.rate_limit_hit(uuid, text, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.audit(text, text, text, jsonb, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.call_edge_function(text, jsonb)', 'execute'),
  'rate_limit_hit, audit and call_edge_function are internal'
);

select ok(
  not exists (select 1 from pg_extension where extname = 'pg_graphql'),
  'the GraphQL extension is not installed'
);

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

select is(
  (select string_agg(id, ', ') from storage.buckets where public),
  null,
  'every bucket is private'
);

select is(
  (select string_agg(id, ', ') from storage.buckets
    where file_size_limit is null or allowed_mime_types is null or cardinality(allowed_mime_types) = 0),
  null,
  'every bucket has a size limit and a MIME type list'
);

select is(
  (select string_agg(id, ', ') from storage.buckets
    where id in ('form-templates', 'lesson-files')
      and (file_size_limit > 20971520 or not allowed_mime_types <@ array['application/pdf', 'image/png'])),
  null,
  'form and lesson files: PDF (and rendered page PNGs) only, 20 MB at most'
);

select is(
  (select string_agg(id, ', ') from storage.buckets
    where id in ('dar-photos', 'incident-photos', 'chat-attachments')
      and (file_size_limit > 10485760 or exists (select 1 from unnest(allowed_mime_types) m where m !~ '^image/'))),
  null,
  'photo buckets: images only, 10 MB at most'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and permissive = 'RESTRICTIVE' and cmd = 'INSERT'
           and with_check ~ 'storage_upload_allowed' and with_check ~ 'incident-photos'),
  'a restrictive upload policy checks file type per bucket and the upload rate'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000018a1');
set local role authenticated;

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('incident-photos', '00000000-0000-0000-0000-0000000018a1/x/report.pdf', '00000000-0000-0000-0000-0000000018a1') $$,
  '42501', null,
  'a PDF can''t be uploaded to the incident photos bucket'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('incident-photos', '00000000-0000-0000-0000-0000000018a1/x/photo-0.jpg', '00000000-0000-0000-0000-0000000018a1') $$,
  'a JPEG in the officer''s own folder uploads'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('incident-photos', '00000000-0000-0000-0000-0000000018a2/x/photo.jpg', '00000000-0000-0000-0000-0000000018a1') $$,
  '42501', null,
  'an officer can''t upload into another officer''s folder'
);

select lives_ok(
  $$ do $d$ begin
       for i in 1..59 loop
         insert into storage.objects (bucket_id, name, owner_id)
         values ('incident-photos', '00000000-0000-0000-0000-0000000018a1/x/photo-' || i || '.jpg',
                 '00000000-0000-0000-0000-0000000018a1');
       end loop;
     end $d$ $$,
  '60 uploads in 10 minutes are allowed'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('incident-photos', '00000000-0000-0000-0000-0000000018a1/x/photo-61.jpg', '00000000-0000-0000-0000-0000000018a1') $$,
  '42501', null,
  'the 61st upload in 10 minutes is refused (rate limit)'
);

-- ---------------------------------------------------------------------------
-- Column protection (officer on their own rows)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000018a1' $$,
  '42501', null,
  'an officer can''t change their own role'
);

select throws_ok(
  $$ update public.profiles set employment_status = 'active', created_at = now() - interval '1 year'
      where id = '00000000-0000-0000-0000-0000000018a1' $$,
  '42501', null,
  'an officer can''t change their own employment status or created_at'
);

select throws_ok(
  $$ update public.notifications set title = 'Forged' where id = '00000000-0000-0000-0000-00000018b001' $$,
  '42501', null,
  'an officer can only change read_at on a notification'
);

update public.notifications set read_at = '2020-01-01' where id = '00000000-0000-0000-0000-00000018b001';
select is(
  (select read_at from public.notifications where id = '00000000-0000-0000-0000-00000018b001'),
  now(),
  'read_at is the server''s time, not the one sent'
);

select throws_ok(
  $$ update public.user_devices set revoked_at = now(), registered_at = now() - interval '1 year'
      where user_id = '00000000-0000-0000-0000-0000000018a1' $$,
  '42501', null,
  'an officer can''t change or revoke their registered device'
);

select throws_ok(
  $$ update public.timesheet_entries set corrected_clock_in_at = now() $$,
  '42501', null,
  'officers can''t update timesheet entries'
);

select throws_ok(
  $$ update public.welfare_checks set status = 'responded' $$,
  '42501', null,
  'officers can''t update welfare checks'
);

select throws_ok(
  $$ update public.incidents set status = 'approved' $$,
  '42501', null,
  'officers can''t update incidents'
);

select throws_ok(
  $$ update public.attendance_events set flags = '{}' $$,
  '42501', null,
  'officers can''t update attendance events'
);

select is_empty(
  $$ update public.assessment_attempts set score_percent = 100, passed = true returning 1 $$,
  'officers can''t change quiz scores'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000018a2');
insert into public.user_devices (user_id, device_id, platform, registered_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000018a2', 'p18-phone-2', 'android', '2020-01-01', '2020-01-01');
select ok(
  (select registered_at = now() and last_seen_at = now() from public.user_devices
    where device_id = 'p18-phone-2'),
  'a device registration gets the server''s time'
);

set local role postgres;

select ok(
  pg_get_functiondef('public.form_submissions_before_write'::regproc)
    ~ '''status'', ''signed_at'', ''submitted_at'', ''reviewer_id'',\s+''review_notes'', ''reviewed_at''',
  'officers can''t change a form submission''s status, review fields or timestamps (guard trigger)'
);

select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.messages'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ~ 'split_part\(attachment_path, ''/''::text, 1\) = \(conversation_id\)::text'
           and pg_get_constraintdef(oid) ~ 'split_part\(attachment_path, ''/''::text, 2\) = \(sender_id\)::text'),
  'a chat attachment must be in the message''s own conversation and sender folder (check constraint)'
);

-- ---------------------------------------------------------------------------
-- Rate limits
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ do $d$ begin
       for i in 1..6 loop
         perform public.rate_limit_hit('00000000-0000-0000-0000-0000000018a1', 'p18_test', 6, 3600);
       end loop;
     end $d$ $$,
  'rate_limit_hit allows up to the limit'
);

select throws_ok(
  $$ select public.rate_limit_hit('00000000-0000-0000-0000-0000000018a1', 'p18_test', 6, 3600) $$,
  'DG429', null,
  'and refuses the next one with DG429'
);

select ok(
  exists (select 1 from pg_trigger where tgname = 'sos_alerts_rate_limit' and tgrelid = 'public.sos_alerts'::regclass)
  and pg_get_functiondef('public.sos_alerts_rate_limit'::regproc) ~ 'sos_raise',
  'new SOS alerts are rate limited'
);

select ok(
  exists (select 1 from pg_trigger where tgname = 'assessment_attempts_rate_limit')
  and pg_get_functiondef('public.assessment_attempts_rate_limit'::regproc) ~ 'quiz_submit',
  'quiz starts and submissions are rate limited'
);

select ok(
  pg_get_functiondef('public.respond_welfare_check(uuid, timestamptz, boolean, boolean, text)'::regprocedure)
    ~ 'rate_limit_hit\(v_uid, ''welfare_respond''',
  'welfare answers are rate limited'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000018a1');
set local role authenticated;
select is(
  public.effective_max_attempts(
    row(gen_random_uuid(), gen_random_uuid(), 70, 3, null, false, false, null, now(), now())::public.assessments,
    '00000000-0000-0000-0000-0000000018a2'),
  0,
  'an officer can''t read another officer''s quiz attempt allowance'
);
select is(
  public.effective_max_attempts(
    row(gen_random_uuid(), gen_random_uuid(), 70, 3, null, false, false, null, now(), now())::public.assessments,
    '00000000-0000-0000-0000-0000000018a1'),
  3,
  'but can read their own'
);
select throws_ok(
  $$ select public.enforce_rate_limit('invite') $$,
  '42501', null,
  'officers can''t use the invite limit (or invite)'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000018f1');
select lives_ok(
  $$ do $d$ begin for i in 1..30 loop perform public.enforce_rate_limit('invite'); end loop; end $d$ $$,
  'an admin can invite 30 people an hour'
);
select throws_ok(
  $$ select public.enforce_rate_limit('invite') $$,
  'DG429', null,
  'the 31st invite in an hour is refused'
);
select throws_ok(
  $$ select public.enforce_rate_limit('anything') $$,
  '22023', null,
  'only known actions can be rate limited'
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

update public.profiles set role = 'supervisor' where id = '00000000-0000-0000-0000-0000000018a2';
update public.profiles set employment_status = 'terminated' where id = '00000000-0000-0000-0000-0000000018a2';
update public.user_devices set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000018a1';
select lives_ok(
  $$ select public.log_audit_event('payroll_export', 'pay_period', 'p18', '{"format": "csv"}') $$,
  'an admin records a payroll export'
);
set local role postgres;

select results_eq(
  $$ select action, actor_id from public.audit_log
      where target_id = '00000000-0000-0000-0000-0000000018a2' and action in ('role_changed', 'user_terminated')
      order by id $$,
  $$ values ('role_changed', '00000000-0000-0000-0000-0000000018f1'::uuid),
            ('user_terminated', '00000000-0000-0000-0000-0000000018f1'::uuid) $$,
  'role changes and terminations are audited with the admin who made them'
);

select ok(
  exists (select 1 from public.audit_log where action = 'device_reset'
           and target_id = '00000000-0000-0000-0000-0000000018a1'
           and actor_id = '00000000-0000-0000-0000-0000000018f1'),
  'device resets are audited'
);

select ok(
  exists (select 1 from public.audit_log where action = 'device_registered'
           and target_id = '00000000-0000-0000-0000-0000000018a2'),
  'device registrations are audited'
);

select ok(
  exists (select 1 from public.audit_log where action = 'payroll_export' and target_id = 'p18'
           and actor_id = '00000000-0000-0000-0000-0000000018f1' and actor_role = 'admin'),
  'payroll exports are audited'
);

insert into auth.sessions (id, user_id, aal) values
  ('00000000-0000-0000-0000-00000018c001', '00000000-0000-0000-0000-0000000018a1', 'aal1');
select ok(
  exists (select 1 from public.audit_log where action = 'login'
           and actor_id = '00000000-0000-0000-0000-0000000018a1'
           and target_id = '00000000-0000-0000-0000-00000018c001'),
  'sign-ins are audited'
);

select ok(
  exists (select 1 from pg_trigger where tgname = 'audit_timesheet_corrections')
  and exists (select 1 from pg_trigger where tgname = 'audit_form_reviews')
  and exists (select 1 from pg_trigger where tgname = 'audit_pay_periods')
  and exists (select 1 from pg_trigger where tgname = 'audit_welfare_pauses'),
  'timesheet corrections, form reviews, pay period locks and welfare pauses are audited'
);

select throws_ok(
  $$ update public.audit_log set details = '{}' $$,
  '42501', null,
  'audit entries can''t be changed, even by the database owner'
);
select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null,
  'audit entries can''t be deleted'
);
select throws_ok(
  $$ truncate public.audit_log $$,
  '42501', null,
  'the audit log can''t be truncated'
);

set local role service_role;
select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null,
  'not even with the service role'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000018f1');
set local role authenticated;
select throws_ok(
  $$ insert into public.audit_log (action) values ('login') $$,
  '42501', null,
  'nobody writes audit entries directly'
);
select throws_ok(
  $$ select public.log_audit_event('role_changed', 'user', 'x') $$,
  '22023', null,
  'log_audit_event can''t forge entries that only triggers make'
);
select ok(
  (select count(*) from public.audit_log) > 0,
  'admins can read the audit log'
);

select pg_temp.login_as('00000000-0000-0000-0000-0000000018e1');
select is((select count(*)::int from public.audit_log), 0, 'supervisors can''t read the audit log');

select pg_temp.login_as('00000000-0000-0000-0000-0000000018a1');
select throws_ok(
  $$ select public.log_audit_event('payroll_export') $$,
  '42501', null,
  'officers can''t write audit events'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Edge Functions called by the database
-- ---------------------------------------------------------------------------

select ok(
  pg_get_functiondef('public.call_edge_function'::regproc) ~ 'x-deltaguard-cron-secret'
  and pg_get_functiondef('public.request_push_delivery'::regproc) ~ 'call_edge_function'
  and pg_get_functiondef('public.request_sos_sms'::regproc) ~ 'call_edge_function'
  and pg_get_functiondef('public.request_welfare_delivery'::regproc) ~ 'call_edge_function',
  'database calls to Edge Functions carry the shared secret'
);

select * from finish();
rollback;
