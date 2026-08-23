/* Bug fix: "Database error querying schema" (500) on /auth/v1/token — but
   this time on accounts created via create_user_account (e.g. a freshly
   registered student), not the original demo seed.

   Root cause: GoTrue's own Go code expects several auth.users text columns
   to always be a string, never NULL — confirmation_token and recovery_token
   were already handled (0005/0007), but email_change, phone_change,
   phone_change_token, email_change_token_new, email_change_token_current,
   and reauthentication_token were not. Any of those left NULL causes
   GoTrue's row-scan on sign-in to fail with exactly this generic 500.

   This migration:
     1. Gives each of those columns a safe '' default, when the column
        exists on this project's auth schema (versions vary).
     2. Repairs any row that already has NULL in one of them — including
        the student account you just created, without needing to recreate it.
     3. Updates create_user_account and seed_login to set all of them
        explicitly going forward. */

do $$
declare
  c text;
begin
  foreach c in array array[
    'email_change', 'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = c
    ) then
      execute format('alter table auth.users alter column %I set default ''''', c);
      execute format('update auth.users set %I = '''' where %I is null', c, c);
    end if;
  end loop;
end $$;

create or replace function public.create_user_account(
  p_username text, p_password text, p_full_name text, p_role text,
  p_role_def_id text, p_teacher_id text default null, p_student_id text default null,
  p_email text default null, p_phone text default null
) returns uuid language plpgsql security definer as $$
declare
  new_id uuid := gen_random_uuid();
  email text := coalesce(nullif(trim(p_email), ''), p_username || '@riverside.school');
  cols  text;
  vals  text;
  c     text;
begin
  if not public.has_perm('users.manage') then
    raise exception 'Creating accounts requires the users.manage permission.';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username)) then
    raise exception 'That username is already taken.';
  end if;

  cols := 'instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, '
       || 'raw_app_meta_data, raw_user_meta_data, created_at, updated_at, '
       || 'confirmation_token, recovery_token';
  vals := format(
    '%L, %L, %L, %L, %L, crypt(%L, gen_salt(''bf'')), now(), '
    || '%L, jsonb_build_object(''username'', %L), now(), now(), '''', ''''',
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    email, p_password,
    '{"provider":"email","providers":["email"]}', p_username);

  foreach c in array array[
    'audit_info', 'is_anonymous', 'is_sso_user',
    'email_change', 'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = c
    ) then
      cols := cols || ', ' || c;
      vals := vals || case c
        when 'audit_info' then ', ''{}''::jsonb'
        when 'is_anonymous' then ', false'
        when 'is_sso_user' then ', false'
        else ', '''''
      end;
    end if;
  end loop;
  execute format('insert into auth.users (%s) values (%s)', cols, vals);

  insert into auth.identities
    (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values
    (gen_random_uuid(), new_id, jsonb_build_object('sub', new_id::text, 'email', email),
     'email', new_id::text, now(), now(), now());

  insert into public.profiles
    (id, school_id, username, full_name, email, phone, role, role_def_id, status, teacher_id, student_id)
  values
    (new_id, 'school-1', p_username, p_full_name, email, p_phone, p_role, p_role_def_id,
     'active', p_teacher_id, p_student_id);

  insert into public.audit_log (actor_id, actor_name, action, target, detail)
  select auth.uid(), p2.full_name, 'user.create', p_full_name, 'role=' || p_role
  from public.profiles p2 where p2.id = auth.uid();

  return new_id;
end $$;

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
  cols := 'instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, '
       || 'raw_app_meta_data, raw_user_meta_data, created_at, updated_at, '
       || 'confirmation_token, recovery_token';
  vals := format(
    '%L, %L, %L, %L, %L, crypt(%L, gen_salt(''bf'')), now() - %s * interval ''1 day'', '
    || '%L, jsonb_build_object(''username'', %L), now() - %s * interval ''1 day'', now(), '''', ''''',
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, pw, created_days_ago,
    '{"provider":"email","providers":["email"]}', uname, created_days_ago);

  foreach c in array array[
    'audit_info', 'is_anonymous', 'is_sso_user',
    'email_change', 'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = c
    ) then
      cols := cols || ', ' || c;
      vals := vals || case c
        when 'audit_info' then ', ''{}''::jsonb'
        when 'is_anonymous' then ', false'
        when 'is_sso_user' then ', false'
        else ', '''''
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
