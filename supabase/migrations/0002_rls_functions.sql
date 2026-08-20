-- ===========================================================================
-- Riverside SMS — 0002_rls_functions.sql
-- Authorization lives HERE, in PostgreSQL. The client never decides access.
-- All helpers are SECURITY DEFINER so policies never recurse through RLS.
-- ===========================================================================

/* ================= core identity / permission helpers ================= */

create or replace function public.my_profile()
returns public.profiles language sql security definer stable as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.is_active_profile()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.my_role_def()
returns public.role_defs language sql security definer stable as $$
  select r.* from public.role_defs r
  join public.profiles p on p.role_def_id = r.id
  where p.id = auth.uid();
$$;

-- Level-1: role permission. Super admin role_def has all_permissions = true.
create or replace function public.has_perm(perm text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_defs r on r.id = p.role_def_id
    where p.id = auth.uid() and p.status = 'active'
      and ( r.all_permissions
         or exists (select 1 from public.role_permissions rp
                    where rp.role_def_id = r.id and rp.permission_id = perm) )
  );
$$;

create or replace function public.is_super()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles p
    join public.role_defs r on r.id = p.role_def_id
    where p.id = auth.uid() and r.all_permissions and p.status = 'active'
  );
$$;

/* ================= relationship helpers (Level-2) ================= */

-- Students the caller may access: teacher→assigned sections, student→self,
-- guardian→linked children, admin→everyone.
create or replace function public.can_view_student(sid text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and (
      p.role = 'admin'
      or (p.role = 'student' and p.student_id = sid)
      or (p.role = 'guardian' and exists (
            select 1 from public.guardian_students g
            where g.guardian_id = auth.uid() and g.student_id = sid))
      or (p.role = 'teacher' and p.teacher_id is not null and exists (
            select 1
            from public.teacher_assignments ta
            join public.enrollments e
              on e.year_id = ta.year_id and e.class_id = ta.class_id and e.section_id = ta.section_id
            where ta.teacher_id = p.teacher_id and e.student_id = sid and e.status = 'active'))
    )
  );
$$;

-- Teacher write-scope over an assessment structure (year + class + subject).
create or replace function public.teacher_can_write_structure(st_id text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from public.profiles p
    join public.assessment_structures s on s.id = st_id
    join public.teacher_assignments ta
      on ta.teacher_id = p.teacher_id and ta.year_id = s.year_id
     and ta.class_id = s.class_id and ta.subject_id = s.subject_id
    where p.id = auth.uid() and p.role = 'teacher' and p.status = 'active'
  );
$$;

create or replace function public.structure_status(st_id text)
returns text language sql security definer stable as $$
  select coalesce((select status from public.mark_submissions where structure_id = st_id), 'draft');
$$;

/* ================= audience helpers ================= */

create or replace function public.audience_contains(aud jsonb)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and (
      case aud->>'kind'
        when 'everyone' then true
        when 'teachers' then p.role in ('teacher','admin')
        when 'students' then p.role = 'student'
        when 'guardians' then p.role in ('guardian','admin')
        when 'section-students' then p.role = 'student' and exists (
          select 1 from public.enrollments e
          where e.student_id = p.student_id and e.status = 'active'
            and e.class_id = aud->>'classId' and e.section_id = aud->>'sectionId')
        when 'section-guardians' then p.role in ('guardian','admin') and (p.role = 'admin' or exists (
          select 1 from public.guardian_students g
          join public.enrollments e on e.student_id = g.student_id and e.status = 'active'
          where g.guardian_id = auth.uid()
            and e.class_id = aud->>'classId' and e.section_id = aud->>'sectionId'))
        else false
      end
    )
  );
$$;

create or replace function public.can_see_announcement_row(a public.announcements)
returns boolean language sql security definer stable as $$
  select public.is_admin()
      or a.sender_id = auth.uid()
      or ((a.status = 'published' or (a.status = 'scheduled' and a.scheduled_for is not null and a.scheduled_for <= now()))
          and public.audience_contains(a.audience));
$$;

create or replace function public.can_see_event_row(e public.events)
returns boolean language sql security definer stable as $$
  select public.is_admin() or e.created_by = auth.uid() or public.audience_contains(e.audience);
$$;

create or replace function public.can_see_homework_row(h public.homework)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and (
      p.role = 'admin'
      or (p.role = 'teacher' and p.teacher_id is not null and exists (
            select 1 from public.teacher_assignments ta
            where ta.teacher_id = p.teacher_id and ta.year_id = h.year_id
              and ta.class_id = h.class_id and ta.section_id = h.section_id and ta.subject_id = h.subject_id))
      or (p.role = 'student' and exists (
            select 1 from public.enrollments e
            where e.student_id = p.student_id and e.status = 'active'
              and e.year_id = h.year_id and e.class_id = h.class_id and e.section_id = h.section_id))
      or (p.role = 'guardian' and exists (
            select 1 from public.guardian_students g
            join public.enrollments e on e.student_id = g.student_id and e.status = 'active'
            where g.guardian_id = auth.uid()
              and e.year_id = h.year_id and e.class_id = h.class_id and e.section_id = h.section_id))
    )
  );
$$;

create or replace function public.can_see_section(class_id text, section_id text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and (
      p.role = 'admin'
      or (p.role = 'teacher' and p.teacher_id is not null and exists (
            select 1 from public.teacher_assignments ta
            where ta.teacher_id = p.teacher_id and ta.class_id = class_id and ta.section_id = section_id))
      or (p.role = 'student' and exists (
            select 1 from public.enrollments e
            where e.student_id = p.student_id and e.status = 'active'
              and e.class_id = class_id and e.section_id = section_id))
      or (p.role = 'guardian' and exists (
            select 1 from public.guardian_students g
            join public.enrollments e on e.student_id = g.student_id and e.status = 'active'
            where g.guardian_id = auth.uid() and e.class_id = class_id and e.section_id = section_id))
    )
  );
$$;

create or replace function public.is_conversation_member(conv_id text)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.conversation_participants
                 where conversation_id = conv_id and profile_id = auth.uid());
$$;

-- Relationship rule for OPENING a conversation with another user.
create or replace function public.can_message_user(other uuid)
returns boolean language sql security definer stable as $$
  select exists (
    with me as (select * from public.profiles where id = auth.uid() and status = 'active'),
         them as (select * from public.profiles where id = other and status = 'active')
    select 1 from me, them where
      public.has_perm('communication.send') and (
        public.is_admin()
        or (me.role = 'teacher' and them.role = 'admin')
        or (me.role = 'teacher' and them.role = 'teacher')
        or (me.role = 'teacher' and them.role = 'student' and public.can_view_student(them.student_id))
        or (me.role = 'teacher' and them.role = 'guardian' and exists (
              select 1 from public.guardian_students g
              where g.guardian_id = them.id and public.can_view_student(g.student_id)))
        or (me.role = 'student' and them.role = 'admin')
        or (me.role = 'student' and them.role = 'teacher' and public.can_view_student(me.student_id)
            and exists (select 1 from public.teacher_assignments ta
                        join public.enrollments e on e.year_id = ta.year_id
                          and e.class_id = ta.class_id and e.section_id = ta.section_id
                        where ta.teacher_id = them.teacher_id and e.student_id = me.student_id and e.status='active'))
        or (me.role = 'guardian' and them.role = 'admin')
        or (me.role = 'guardian' and them.role = 'teacher' and exists (
              select 1 from public.guardian_students g
              join public.enrollments e on e.student_id = g.student_id and e.status = 'active'
              join public.teacher_assignments ta on ta.year_id = e.year_id
                and ta.class_id = e.class_id and ta.section_id = e.section_id
              where g.guardian_id = me.id and ta.teacher_id = them.teacher_id))
      )
  );
$$;

/* ================= mark workflow triggers ================= */

-- Marks are writable ONLY while the structure is draft/returned, and always
-- range-checked against the item maximum.
create or replace function public.tg_marks_lock()
returns trigger language plpgsql security definer as $$
declare
  st_id text;
  v_max numeric;
  v_raw numeric;
begin
  st_id := coalesce(new.structure_id, old.structure_id);
  if public.structure_status(st_id) not in ('draft','returned') then
    raise exception 'Marks are locked: this assessment is %. Reopen it before editing.',
      public.structure_status(st_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select max_mark into v_max from public.assessment_items where id = new.item_id;
    if new.raw_mark > v_max then
      raise exception 'Mark % exceeds the maximum of % for this assessment.', new.raw_mark, v_max;
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_marks_lock on public.assessment_marks;
create trigger trg_marks_lock
  before insert or update or delete on public.assessment_marks
  for each row execute function public.tg_marks_lock();

-- Immutable audit history for every mark change.
create or replace function public.tg_mark_audit()
returns trigger language plpgsql security definer as $$
declare
  actor uuid := auth.uid();
  aname text;
begin
  select full_name into aname from public.profiles where id = actor;
  if tg_op = 'INSERT' then
    insert into public.mark_audit (structure_id, item_id, student_id, old_value, new_value, actor, actor_name)
    values (new.structure_id, new.item_id, new.student_id, null, new.raw_mark, actor, aname);
  elsif tg_op = 'UPDATE' then
    if old.raw_mark is distinct from new.raw_mark then
      insert into public.mark_audit (structure_id, item_id, student_id, old_value, new_value, actor, actor_name)
      values (new.structure_id, new.item_id, new.student_id, old.raw_mark, new.raw_mark, actor, aname);
    end if;
  else
    insert into public.mark_audit (structure_id, item_id, student_id, old_value, new_value, actor, actor_name)
    values (old.structure_id, old.item_id, old.student_id, old.raw_mark, null, actor, aname);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_mark_audit on public.assessment_marks;
create trigger trg_mark_audit
  after insert or update or delete on public.assessment_marks
  for each row execute function public.tg_mark_audit();

-- Submission state machine:
--   draft → submitted (teacher with scope)
--   submitted → approved | returned (results.manage, NOT the submitter unless super)
--   returned → submitted (teacher with scope)
--   approved → published (results.publish)
--   any → draft (super admin ONLY, with reopen_reason)
create or replace function public.tg_submission_state()
returns trigger language plpgsql security definer as $$
declare
  me uuid := auth.uid();
begin
  if new.status = old.status then
    return new;
  end if;

  -- Reopen path: super admin only, reason mandatory, audit recorded.
  if new.status = 'draft' then
    if not public.is_super() then
      raise exception 'Only a super admin can reopen a marks workflow.';
    end if;
    if new.reopen_reason is null or length(trim(new.reopen_reason)) = 0 then
      raise exception 'A reason is required to reopen approved marks.';
    end if;
    insert into public.mark_audit (structure_id, actor, actor_name, reason)
    select new.structure_id, me, p.full_name, 'REOPEN: ' || new.reopen_reason
    from public.profiles p where p.id = me;
    return new;
  end if;

  if old.status in ('draft','returned') and new.status = 'submitted' then
    if not (public.is_admin() or public.teacher_can_write_structure(new.structure_id)) then
      raise exception 'You are not assigned to this subject — cannot submit its marks.';
    end if;
    new.submitted_by := me; new.submitted_at := now();
    return new;
  end if;

  if old.status = 'submitted' and new.status in ('approved','returned') then
    if not public.has_perm('results.manage') then
      raise exception 'Approving or returning marks requires the results.manage permission.';
    end if;
    -- Separation of duties: no self-approval (super admin exempt).
    if new.status = 'approved' and old.submitted_by = me and not public.is_super() then
      raise exception 'You submitted these marks — a different administrator must approve them.';
    end if;
    if new.status = 'approved' then
      new.approved_by := me; new.approved_at := now();
    else
      if new.return_reason is null or length(trim(new.return_reason)) = 0 then
        raise exception 'A reason is required to return marks for correction.';
      end if;
      new.returned_by := me; new.returned_at := now();
    end if;
    return new;
  end if;

  if old.status = 'approved' and new.status = 'published' then
    if not public.has_perm('results.publish') then
      raise exception 'Publishing results requires the results.publish permission.';
    end if;
    new.published_by := me; new.published_at := now();
    return new;
  end if;

  raise exception 'Invalid workflow transition: % → %', old.status, new.status;
end $$;

drop trigger if exists trg_submission_state on public.mark_submissions;
create trigger trg_submission_state
  before update on public.mark_submissions
  for each row execute function public.tg_submission_state();

/* ================= profile protection ================= */

create or replace function public.tg_profile_protect()
returns trigger language plpgsql security definer as $$
begin
  -- Privileged fields cannot be changed through the normal update path.
  if new.role is distinct from old.role
     or new.role_def_id is distinct from old.role_def_id
     or new.status is distinct from old.status
     or new.teacher_id is distinct from old.teacher_id
     or new.student_id is distinct from old.student_id
     or new.school_id is distinct from old.school_id then
    if not public.has_perm('users.manage') then
      raise exception 'Role, status and account links can only be changed by an administrator.';
    end if;
    if new.role_def_id is distinct from old.role_def_id and not public.is_super() then
      raise exception 'Only a super admin may change permission profiles.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profile_protect on public.profiles;
create trigger trg_profile_protect
  before update on public.profiles
  for each row execute function public.tg_profile_protect();

/* ================= announcement scope trigger ================= */

create or replace function public.tg_announcement_scope()
returns trigger language plpgsql security definer as $$
begin
  if new.audience->>'kind' = 'everyone' and not public.has_perm('communication.school_wide') then
    raise exception 'School-wide announcements require the communication.school_wide permission.';
  end if;
  return new;
end $$;

drop trigger if exists trg_announcement_scope on public.announcements;
create trigger trg_announcement_scope
  before insert or update of audience, status on public.announcements
  for each row execute function public.tg_announcement_scope();

/* ================= RPCs (privileged, definer) ================= */

-- Creating an auth user needs the service role; this definer function does it
-- server-side, gated by users.manage. No privileged key ever reaches the client.
create or replace function public.create_user_account(
  p_username text, p_password text, p_full_name text, p_role text,
  p_role_def_id text, p_teacher_id text default null, p_student_id text default null,
  p_email text default null, p_phone text default null
) returns uuid language plpgsql security definer as $$
declare
  new_id uuid := gen_random_uuid();
  email text := coalesce(p_email, p_username || '@riverside.school');
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

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token)
  values
    ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', email,
     crypt(p_password, gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', jsonb_build_object('username', p_username),
     now(), now(), '', '');

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

-- Structured audit entry; actor comes from the session, never the client.
create or replace function public.log_action(p_action text, p_target text default null, p_detail text default null)
returns void language plpgsql security definer as $$
begin
  insert into public.audit_log (actor_id, actor_name, action, target, detail)
  select auth.uid(), p.full_name, p_action, p_target, p_detail
  from public.profiles p where p.id = auth.uid();
end $$;

-- Notification fan-out. Non-admins may only notify users they are related to.
create or replace function public.notify_users(p_ids uuid[], p_type text, p_title text, p_body text)
returns void language plpgsql security definer as $$
declare
  target uuid;
begin
  if not public.has_perm('communication.send') then
    raise exception 'You do not have permission to send notifications.';
  end if;
  if not public.is_admin() then
    foreach target in array p_ids loop
      if not public.can_message_user(target) and target <> auth.uid() then
        raise exception 'You are not authorized to notify this user.';
      end if;
    end loop;
  end if;
  insert into public.notifications (profile_id, type, title, body)
  select distinct u.id, p_type, p_title, p_body
  from unnest(p_ids) u(id)
  join public.profiles pr on pr.id = u.id and pr.status = 'active';
end $$;

-- Marks upsert for ONE student within a structure (lock + audit via triggers).
create or replace function public.save_student_marks(p_structure_id text, p_student_id text, p_values jsonb)
returns void language plpgsql security definer as $$
declare
  k text;
begin
  if not public.can_view_student(p_student_id) then
    raise exception 'You do not have access to this student.';
  end if;
  if not (public.is_admin() or public.teacher_can_write_structure(p_structure_id)) then
    raise exception 'You are not assigned to enter marks for this assessment.';
  end if;
  -- remove rows not present in the payload
  delete from public.assessment_marks m
  where m.structure_id = p_structure_id and m.student_id = p_student_id
    and not (p_values ? m.item_id);
  -- upsert payload
  for k in select jsonb_object_keys(p_values) loop
    if p_values->>k is null then
      delete from public.assessment_marks
      where structure_id = p_structure_id and student_id = p_student_id and item_id = k;
    else
      insert into public.assessment_marks (id, structure_id, item_id, student_id, raw_mark, entered_by)
      values (p_structure_id || ':' || p_student_id || ':' || k, p_structure_id, k, p_student_id,
              (p_values->>k)::numeric, auth.uid())
      on conflict (item_id, student_id) do update
        set raw_mark = excluded.raw_mark, entered_by = auth.uid();
    end if;
  end loop;
end $$;

/* ================= RLS ================= */

alter table public.schools               enable row level security;
alter table public.academic_years        enable row level security;
alter table public.terms                 enable row level security;
alter table public.classes               enable row level security;
alter table public.sections              enable row level security;
alter table public.subjects              enable row level security;
alter table public.teachers              enable row level security;
alter table public.students              enable row level security;
alter table public.enrollments           enable row level security;
alter table public.student_documents     enable row level security;
alter table public.permissions           enable row level security;
alter table public.role_defs             enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.profiles              enable row level security;
alter table public.guardian_students     enable row level security;
alter table public.teacher_assignments   enable row level security;
alter table public.timetable_entries     enable row level security;
alter table public.homework              enable row level security;
alter table public.assessment_structures enable row level security;
alter table public.assessment_items      enable row level security;
alter table public.assessment_marks      enable row level security;
alter table public.mark_submissions      enable row level security;
alter table public.mark_audit            enable row level security;
alter table public.grade_bands           enable row level security;
alter table public.attendance_registers  enable row level security;
alter table public.attendance_entries    enable row level security;
alter table public.fee_items             enable row level security;
alter table public.announcements         enable row level security;
alter table public.announcement_reads    enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages              enable row level security;
alter table public.message_reports       enable row level security;
alter table public.notifications         enable row level security;
alter table public.events                enable row level security;
alter table public.audit_log             enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.schools, public.academic_years, public.terms, public.classes, public.sections,
  public.subjects, public.teachers, public.students, public.enrollments, public.student_documents,
  public.permissions, public.role_defs, public.role_permissions, public.profiles,
  public.guardian_students, public.teacher_assignments, public.timetable_entries, public.homework,
  public.assessment_structures, public.assessment_items, public.assessment_marks,
  public.mark_submissions, public.mark_audit, public.grade_bands, public.attendance_registers,
  public.attendance_entries, public.fee_items, public.announcements, public.announcement_reads,
  public.conversations, public.conversation_participants, public.messages, public.message_reports,
  public.notifications, public.events, public.audit_log
to authenticated;
grant execute on function
  public.has_perm(text), public.is_admin(), public.is_super(), public.can_view_student(text),
  public.teacher_can_write_structure(text), public.structure_status(text),
  public.can_message_user(uuid), public.create_user_account(text,text,text,text,text,text,text,text,text),
  public.log_action(text,text,text), public.notify_users(uuid[],text,text,text),
  public.save_student_marks(text,text,jsonb), public.my_profile()
to authenticated;

do $$
begin
  /* ---- school structure: everyone authenticated reads; admins write ---- */
  create policy schools_sel        on public.schools        for select to authenticated using (true);
  create policy schools_wri        on public.schools        for all    to authenticated using (public.has_perm('settings.manage')) with check (public.has_perm('settings.manage'));
  create policy years_sel          on public.academic_years for select to authenticated using (true);
  create policy years_wri          on public.academic_years for all    to authenticated using (public.has_perm('academics.manage')) with check (public.has_perm('academics.manage'));
  create policy terms_sel          on public.terms          for select to authenticated using (true);
  create policy terms_wri          on public.terms          for all    to authenticated using (public.has_perm('academics.manage')) with check (public.has_perm('academics.manage'));
  create policy classes_sel        on public.classes        for select to authenticated using (true);
  create policy classes_wri        on public.classes        for all    to authenticated using (public.has_perm('academics.manage')) with check (public.has_perm('academics.manage'));
  create policy sections_sel       on public.sections       for select to authenticated using (true);
  create policy sections_wri       on public.sections       for all    to authenticated using (public.has_perm('academics.manage')) with check (public.has_perm('academics.manage'));
  create policy subjects_sel       on public.subjects       for select to authenticated using (true);
  create policy subjects_wri       on public.subjects       for all    to authenticated using (public.has_perm('academics.manage')) with check (public.has_perm('academics.manage'));
  create policy teachers_sel       on public.teachers       for select to authenticated using (true);
  create policy teachers_wri       on public.teachers       for all    to authenticated using (public.has_perm('teachers.manage')) with check (public.has_perm('teachers.manage'));
  create policy assignments_sel    on public.teacher_assignments for select to authenticated using (true);
  create policy assignments_wri    on public.teacher_assignments for all  to authenticated using (public.has_perm('academics.manage')) with check (public.has_perm('academics.manage'));
  create policy timetable_sel      on public.timetable_entries for select to authenticated using (true);
  create policy timetable_wri      on public.timetable_entries for all  to authenticated using (public.has_perm('academics.manage')) with check (public.has_perm('academics.manage'));
  create policy gradesel           on public.grade_bands    for select to authenticated using (true);
  create policy gradewri           on public.grade_bands    for all    to authenticated using (public.has_perm('results.manage')) with check (public.has_perm('results.manage'));
  create policy perms_sel          on public.permissions    for select to authenticated using (true);
  create policy roledef_sel        on public.role_defs      for select to authenticated using (true);
  create policy roleperm_sel       on public.role_permissions for select to authenticated using (true);
  create policy roles_wri          on public.role_defs      for all    to authenticated using (public.has_perm('roles.manage')) with check (public.has_perm('roles.manage'));
  create policy roleperm_wri       on public.role_permissions for all  to authenticated using (public.has_perm('roles.manage')) with check (public.has_perm('roles.manage'));

  /* ---- people: relationship-scoped ---- */
  create policy students_sel  on public.students     for select to authenticated using (public.can_view_student(id));
  create policy students_ins  on public.students     for insert to authenticated with check (public.has_perm('students.create'));
  create policy students_upd  on public.students     for update to authenticated using (public.has_perm('students.edit')) with check (public.has_perm('students.edit'));
  create policy students_del  on public.students     for delete to authenticated using (public.has_perm('students.delete'));
  create policy enroll_sel    on public.enrollments  for select to authenticated using (public.can_view_student(student_id));
  create policy enroll_wri    on public.enrollments  for all    to authenticated using (public.has_perm('students.edit')) with check (public.has_perm('students.edit'));
  create policy docs_sel      on public.student_documents for select to authenticated using (public.can_view_student(student_id));
  create policy docs_wri      on public.student_documents for all  to authenticated using (public.has_perm('students.edit')) with check (public.has_perm('students.edit'));
  create policy guardian_sel  on public.guardian_students for select to authenticated using (guardian_id = auth.uid() or public.can_view_student(student_id));
  create policy guardian_wri  on public.guardian_students for all  to authenticated using (public.has_perm('students.edit')) with check (public.has_perm('students.edit'));

  /* ---- profiles: directory readable, self-service limited, admin-gated ---- */
  create policy profiles_sel on public.profiles for select to authenticated using (true);
  create policy profiles_upd on public.profiles for update to authenticated
    using (id = auth.uid() or public.has_perm('users.manage'))
    with check (id = auth.uid() or public.has_perm('users.manage'));

  /* ---- homework / attendance / fees ---- */
  create policy homework_sel on public.homework for select to authenticated using (public.can_see_homework_row(homework));
  create policy homework_wri on public.homework for all to authenticated
    using (public.has_perm('homework.manage')) with check (public.has_perm('homework.manage'));
  create policy attreg_sel on public.attendance_registers for select to authenticated
    using (public.can_see_section(class_id, section_id));
  create policy attreg_wri on public.attendance_registers for all to authenticated
    using (public.has_perm('attendance.manage') and public.can_see_section(class_id, section_id))
    with check (public.has_perm('attendance.manage') and public.can_see_section(class_id, section_id));
  create policy attent_sel on public.attendance_entries for select to authenticated
    using (exists (select 1 from public.attendance_registers r where r.id = register_id and public.can_see_section(r.class_id, r.section_id)));
  create policy attent_wri on public.attendance_entries for all to authenticated
    using (public.has_perm('attendance.manage')) with check (public.has_perm('attendance.manage'));
  create policy fees_sel on public.fee_items for select to authenticated
    using (public.is_admin() or exists (select 1 from public.guardian_students g where g.guardian_id = auth.uid() and g.student_id = student_id));
  create policy fees_wri on public.fee_items for all to authenticated
    using (public.has_perm('fees.manage')) with check (public.has_perm('fees.manage'));

  /* ---- assessments & marks ---- */
  create policy structs_sel on public.assessment_structures for select to authenticated using (true);
  create policy structs_wri on public.assessment_structures for all to authenticated
    using (public.has_perm('exams.manage')) with check (public.has_perm('exams.manage'));
  create policy items_sel on public.assessment_items for select to authenticated using (true);
  create policy items_wri on public.assessment_items for all to authenticated
    using (public.has_perm('exams.manage')) with check (public.has_perm('exams.manage'));
  create policy marks_sel on public.assessment_marks for select to authenticated
    using (public.can_view_student(student_id)
      and ( public.is_admin()
         or public.structure_status(structure_id) = 'published'
         or public.teacher_can_write_structure(structure_id) ));
  create policy marks_ins on public.assessment_marks for insert to authenticated
    with check (public.is_admin() or public.teacher_can_write_structure(structure_id));
  create policy marks_upd on public.assessment_marks for update to authenticated
    using (public.is_admin() or public.teacher_can_write_structure(structure_id))
    with check (public.is_admin() or public.teacher_can_write_structure(structure_id));
  create policy marks_del on public.assessment_marks for delete to authenticated
    using (public.is_admin() or public.teacher_can_write_structure(structure_id));
  create policy subs_sel on public.mark_submissions for select to authenticated
    using (public.is_admin() or public.teacher_can_write_structure(structure_id));
  create policy subs_ins on public.mark_submissions for insert to authenticated
    with check (public.is_admin() or public.teacher_can_write_structure(structure_id));
  create policy subs_upd on public.mark_submissions for update to authenticated
    using (public.is_admin() or public.teacher_can_write_structure(structure_id) or public.has_perm('results.manage'))
    with check (public.is_admin() or public.teacher_can_write_structure(structure_id) or public.has_perm('results.manage'));
  create policy maudit_sel on public.mark_audit for select to authenticated
    using (public.has_perm('audit.view') or public.is_admin() or public.teacher_can_write_structure(structure_id));

  /* ---- communication ---- */
  create policy ann_sel on public.announcements for select to authenticated using (public.can_see_announcement_row(announcements));
  create policy ann_ins on public.announcements for insert to authenticated
    with check (public.has_perm('communication.create_announcement'));
  create policy ann_upd on public.announcements for update to authenticated
    using (public.has_perm('communication.manage_announcement')
        or (sender_id = auth.uid() and status in ('draft','scheduled')))
    with check (public.has_perm('communication.manage_announcement') or sender_id = auth.uid());
  create policy ann_del on public.announcements for delete to authenticated using (public.has_perm('communication.delete'));
  create policy annreads_sel on public.announcement_reads for select to authenticated using (profile_id = auth.uid() or public.is_admin());
  create policy annreads_ins on public.announcement_reads for insert to authenticated with check (profile_id = auth.uid());

  create policy conv_sel on public.conversations for select to authenticated
    using (public.is_conversation_member(id) or public.has_perm('communication.moderate'));
  create policy conv_ins on public.conversations for insert to authenticated
    with check (public.has_perm('communication.send'));
  create policy conv_upd on public.conversations for update to authenticated
    using (public.is_conversation_member(id) or public.has_perm('communication.moderate'))
    with check (public.is_conversation_member(id) or public.has_perm('communication.moderate'));
  create policy convp_sel on public.conversation_participants for select to authenticated
    using (profile_id = auth.uid() or public.is_conversation_member(conversation_id) or public.has_perm('communication.moderate'));
  create policy convp_ins on public.conversation_participants for insert to authenticated
    with check (profile_id = auth.uid() and public.has_perm('communication.send'));
  create policy msg_sel on public.messages for select to authenticated
    using (public.is_conversation_member(conversation_id) or public.has_perm('communication.moderate'));
  create policy msg_ins on public.messages for insert to authenticated
    with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id) and public.has_perm('communication.send'));
  create policy msg_upd on public.messages for update to authenticated
    using (public.is_conversation_member(conversation_id)) with check (public.is_conversation_member(conversation_id));
  create policy mrep_ins on public.message_reports for insert to authenticated
    with check (reporter_id = auth.uid() and public.is_conversation_member(conversation_id));
  create policy mrep_sel on public.message_reports for select to authenticated using (public.has_perm('communication.moderate'));
  create policy mrep_upd on public.message_reports for update to authenticated
    using (public.has_perm('communication.moderate')) with check (public.has_perm('communication.moderate'));

  create policy notif_sel on public.notifications for select to authenticated using (profile_id = auth.uid() or public.is_admin());
  create policy notif_upd on public.notifications for update to authenticated
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());

  create policy events_sel on public.events for select to authenticated using (public.can_see_event_row(events));
  create policy events_wri on public.events for all to authenticated
    using (public.has_perm('events.manage')) with check (public.has_perm('events.manage'));

  create policy audit_sel on public.audit_log for select to authenticated using (public.has_perm('audit.view') or public.is_super());
exception when duplicate_object then null;
end $$;

/* ================= storage ================= */

insert into storage.buckets (id, name, public)
values ('student-documents','student-documents',false),
       ('profile-photos','profile-photos',false)
on conflict (id) do nothing;

do $$
begin
  create policy doc_read on storage.objects for select to authenticated
    using (bucket_id in ('student-documents','profile-photos')
      and public.can_view_student((storage.foldername(name))[1]));
  create policy doc_write on storage.objects for insert to authenticated
    with check (bucket_id in ('student-documents','profile-photos')
      and public.has_perm('students.edit')
      and public.can_view_student((storage.foldername(name))[1]));
  create policy doc_delete on storage.objects for delete to authenticated
    using (bucket_id in ('student-documents','profile-photos')
      and public.has_perm('students.edit')
      and public.can_view_student((storage.foldername(name))[1]));
exception when duplicate_object then null;
end $$;
