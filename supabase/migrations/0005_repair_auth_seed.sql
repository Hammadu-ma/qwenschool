-- ===========================================================================
-- Riverside SMS — 0005_repair_auth_seed.sql
-- Repairs "500 Database error querying schema" on /auth/v1/token.
--
-- Root cause: GoTrue (Supabase Auth) expects auth.users to carry newer
-- columns (audit_info, is_anonymous, is_sso_user). Users seeded via plain
-- SQL without them can leave the auth schema inconsistent, and GoTrue's
-- schema introspection fails on sign-in.
--
-- This file is idempotent and non-destructive:
--   1. gives audit_info a safe default (if the column exists but has none)
--   2. replaces public.seed_login with a version that writes ONLY the
--      columns that actually exist on auth.users
--   3. re-seeds every demo login (existing rows are left untouched)
-- ===========================================================================

/* 1 — make audit_info safe for GoTrue */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and column_name = 'audit_info' and column_default is null
  ) then
    alter table auth.users alter column audit_info set default '{}'::jsonb;
  end if;
end $$;

/* 2 — resilient seed_login: only writes columns present in this project */
create or replace function public.seed_login(
  uid uuid, uname text, pw text, full_name text, base_role text, role_def text,
  teacher_id text default null, student_id text default null,
  status text default 'active', created_days_ago integer default 45,
  children text[] default '{}'
) returns void language plpgsql as $$
declare
  email text := uname || '@riverside.school';
  cols  text;
  vals  text;
  c     text;
begin
  -- columns present in every Supabase auth schema
  cols := 'instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, '
       || 'raw_app_meta_data, raw_user_meta_data, created_at, updated_at, '
       || 'confirmation_token, recovery_token';
  vals := format(
    '%L, %L, %L, %L, %L, crypt(%L, gen_salt(''bf'')), now() - %s * interval ''1 day'', '
    || '%L, jsonb_build_object(''username'', %L), now() - %s * interval ''1 day'', now(), '''', ''''',
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, pw, created_days_ago,
    '{"provider":"email","providers":["email"]}', uname, created_days_ago);

  -- newer GoTrue columns — include them only when this project has them
  foreach c in array array['audit_info', 'is_anonymous', 'is_sso_user'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = c
    ) then
      cols := cols || ', ' || c;
      vals := vals || case c
        when 'audit_info' then ', ''{}''::jsonb'
        else ', false'
      end;
    end if;
  end loop;

  execute format('insert into auth.users (%s) values (%s) on conflict (id) do nothing', cols, vals);

  insert into auth.identities
    (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), uid,
         jsonb_build_object('sub', uid::text, 'email', email),
         'email', uid::text, now(), now(), now()
  where not exists (select 1 from auth.identities where user_id = uid and provider = 'email');

  insert into public.profiles
    (id, school_id, username, full_name, email, role, role_def_id, status, teacher_id, student_id, created_at)
  values
    (uid, 'school-1', uname, full_name, email, base_role, role_def, status, teacher_id, student_id,
     now() - created_days_ago * interval '1 day')
  on conflict (id) do nothing;

  insert into public.guardian_students (guardian_id, student_id, relation)
  select uid, unnest(children), 'Guardian'
  on conflict do nothing;
end $$;

/* 3 — re-seed demo logins (no-ops where the row already exists) */
do $$
begin
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000001', 'root',   'root123',  'Dr. Selam Bekele',  'admin',   'superadmin',  null, null, 'active', 500);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000002', 'admin',  'admin123', 'Amara Tesfaye',   'admin',   'admin',       null, null, 'active', 400);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000003', 'lydia',  'coord123', 'Ms. Lydia Fikre', 'admin',   'coordinator', null, null, 'active', 250);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000004', 'ahmed',  'teach123', 'Mr. Ahmed Yusuf', 'teacher', 'teacher',     't1', null, 'active', 320);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000005', 'hana.g', 'teach123', 'Ms. Hana Girma',  'teacher', 'teacher',     't2', null, 'active', 320);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000006', 'ali',    'teach123', 'Mr. Ali Omar',    'teacher', 'teacher',     't3', null, 'disabled', 300);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000007', 'abebe',  'stud123',  'Abebe Kebede',    'student', 'student',     null, 'st1', 'active', 45);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000008', 'hana.a', 'stud123',  'Hana Alemu',      'student', 'student',     null, 'st2', 'active', 45);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000009', 'kebede', 'fam123',   'Kebede Tesema',   'guardian','guardian',    null, null, 'active', 45, array['st1','st2']);
  perform public.seed_login('7d0a0000-0000-4000-8000-00000000000a', 'almaz',  'fam123',   'Almaz Worku',     'guardian','guardian',    null, null, 'active', 40, array['st3']);
end $$;
