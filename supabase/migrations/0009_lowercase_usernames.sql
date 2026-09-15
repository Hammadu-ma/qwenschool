/* Bug fix: login fails with a 400 "invalid_grant" on /auth/v1/token for any
   account whose username was typed with a capital letter (e.g. "Abebe.K").

   Root cause: usernameToEmail() on the client always lowercases the username
   before building the sign-in email ("abebe.k@riverside.school"), but
   create_user_account() and seed_login() stored the email/username using
   whatever case was typed at creation time ("Abebe.K@riverside.school").
   GoTrue matches email by exact string, so the two never met.

   This migration:
     1. Repairs every account already created with mixed-case email/username.
     2. Rewrites create_user_account and seed_login to always lower() the
        username before using it in the email and before storing it, so this
        class of bug cannot happen again regardless of what the client sends. */

-- 1. Repair existing rows (safe / idempotent — no-op if already lowercase).
update auth.users
   set email = lower(email)
 where email <> lower(email);

update public.profiles
   set username = lower(username),
       email    = lower(email)
 where username <> lower(username)
    or (email is not null and email <> lower(email));

-- 2. Harden create_user_account: normalize the username up front.
create or replace function public.create_user_account(
  p_username text, p_password text, p_full_name text, p_role text,
  p_role_def_id text, p_teacher_id text default null, p_student_id text default null,
  p_email text default null, p_phone text default null
) returns uuid language plpgsql security definer as $$
declare
  uname text := lower(trim(p_username));
  new_id uuid := gen_random_uuid();
  email text := lower(coalesce(nullif(trim(p_email), ''), uname || '@riverside.school'));
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
  if uname = '' then
    raise exception 'Username is required.';
  end if;
  if exists (select 1 from public.profiles where lower(username) = uname) then
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
    '{"provider":"email","providers":["email"]}', uname);

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
    (new_id, 'school-1', uname, p_full_name, email, p_phone, p_role, p_role_def_id,
     'active', p_teacher_id, p_student_id);

  insert into public.audit_log (actor_id, actor_name, action, target, detail)
  select auth.uid(), p2.full_name, 'user.create', p_full_name, 'role=' || p_role
  from public.profiles p2 where p2.id = auth.uid();

  return new_id;
end $$;

-- 3. Same normalization for the demo/seed helper, for consistency.
create or replace function public.seed_login(
  uid uuid, uname text, pw text, full_name text, base_role text, role_def text,
  teacher_id text default null, student_id text default null,
  status text default 'active', created_days_ago integer default 45,
  children text[] default '{}'
) returns void language plpgsql as $$
declare
  norm_uname text := lower(trim(uname));
  email text := norm_uname || '@riverside.school';
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
    '{"provider":"email","providers":["email"]}', norm_uname, created_days_ago);

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
    (uid, 'school-1', norm_uname, full_name, email, base_role, role_def, status, teacher_id, student_id,
     now() - created_days_ago * interval '1 day')
  on conflict (id) do nothing;

  insert into public.guardian_students (guardian_id, student_id, relation)
  select uid, unnest(children), 'Guardian'
  on conflict do nothing;
end $$;

-- 4. Belt-and-braces: stop a mixed-case username ever landing in profiles
-- again, even via a direct update/insert outside the RPC.
alter table public.profiles
  add constraint profiles_username_lowercase check (username = lower(username));
