/* Bug fix: a brand-new account (student, guardian, or any user created with
   a real contact email filled in) is created successfully but can NEVER log
   in — "Incorrect username or password" every time, even with the exact
   password just set.

   Root cause: create_user_account() was using ONE `email` value for two
   different jobs that must never be the same value:
     1. The Auth login identity (auth.users.email / auth.identities) — this
        MUST always be `username@riverside.school`, because the client's
        login screen (usernameToEmail() in src/lib/supabase.ts) only ever
        builds that exact pattern from whatever username the person types.
        It has no way to know a person's real email.
     2. The contact/display email shown in Families, People, etc.
        (public.profiles.email) — this SHOULD be whatever real address the
        admin typed in (e.g. a student's or guardian's personal email).

   Whenever an admin left a real email in the form, create_user_account used
   it as BOTH: the Auth login email became "abebe@gmail.com" instead of
   "abebe.k@riverside.school", so the login page's guess never matched and
   sign-in always failed — while the account otherwise looked completely
   normal (profile exists, password is fine).

   This migration:
     1. Repairs every existing account whose Auth login email doesn't match
        its canonical username@riverside.school form, without touching the
        contact email shown in the UI (public.profiles.email is untouched).
     2. Rewrites create_user_account to always use the canonical
        username@riverside.school address for Auth, and to keep storing the
        real contact email (if any) only in public.profiles.email. */

-- 1. Repair accounts already broken by this bug.
do $$
declare
  r record;
  canonical text;
begin
  for r in select id, username from public.profiles loop
    canonical := lower(trim(r.username)) || '@riverside.school';

    update auth.users
       set email = canonical
     where id = r.id
       and email is distinct from canonical;

    update auth.identities
       set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(canonical))
     where user_id = r.id
       and provider = 'email'
       and identity_data ->> 'email' is distinct from canonical;
  end loop;
end $$;

-- 2. Rewrite create_user_account: Auth email is always canonical; the real
--    contact email (if provided) only ever lands in profiles.email.
create or replace function public.create_user_account(
  p_username text, p_password text, p_full_name text, p_role text,
  p_role_def_id text, p_teacher_id text default null, p_student_id text default null,
  p_email text default null, p_phone text default null
) returns uuid language plpgsql security definer as $$
declare
  uname text := lower(trim(p_username));
  new_id uuid := gen_random_uuid();
  -- Auth login identity — ALWAYS this pattern. Never the contact email:
  -- the client's login screen can only ever guess this exact address.
  auth_email text := lower(trim(p_username)) || '@riverside.school';
  -- Contact/display email shown in the UI — the real address if one was
  -- given, otherwise falls back to the login address for display purposes.
  contact_email text := lower(coalesce(nullif(trim(p_email), ''), auth_email));
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
    auth_email, p_password,
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
    (gen_random_uuid(), new_id, jsonb_build_object('sub', new_id::text, 'email', auth_email),
     'email', new_id::text, now(), now(), now());

  insert into public.profiles
    (id, school_id, username, full_name, email, phone, role, role_def_id, status, teacher_id, student_id)
  values
    (new_id, 'school-1', uname, p_full_name, contact_email, p_phone, p_role, p_role_def_id,
     'active', p_teacher_id, p_student_id);

  insert into public.audit_log (actor_id, actor_name, action, target, detail)
  select auth.uid(), p2.full_name, 'user.create', p_full_name, 'role=' || p_role
  from public.profiles p2 where p2.id = auth.uid();

  return new_id;
end $$;
