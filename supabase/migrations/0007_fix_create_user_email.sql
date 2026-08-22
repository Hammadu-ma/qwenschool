/* Bug fix: create_user_account used coalesce(p_email, ...) to fall back to
   username@riverside.school when no personal email was given. coalesce()
   only substitutes on NULL — but the app was (and defensively still might)
   pass an empty string '' for "no email", which coalesce() does NOT treat
   as missing. That left new accounts (most commonly students, who usually
   have no personal email) with an email of '' in auth.users, which never
   matches the username@riverside.school the login screen computes — so
   the account existed but could never sign in.

   nullif(p_email, '') turns '' into NULL first, so the fallback actually
   applies regardless of what the caller sends. */

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

  -- Write only the columns this project's auth schema actually has
  -- (audit_info / is_anonymous / is_sso_user vary across GoTrue versions).
  cols := 'instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, '
       || 'raw_app_meta_data, raw_user_meta_data, created_at, updated_at, '
       || 'confirmation_token, recovery_token';
  vals := format(
    '%L, %L, %L, %L, %L, crypt(%L, gen_salt(''bf'')), now(), '
    || '%L, jsonb_build_object(''username'', %L), now(), now(), '''', ''''',
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    email, p_password,
    '{"provider":"email","providers":["email"]}', p_username);
  foreach c in array array['audit_info', 'is_anonymous', 'is_sso_user'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = c
    ) then
      cols := cols || ', ' || c;
      vals := vals || case c when 'audit_info' then ', ''{}''::jsonb' else ', false' end;
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
