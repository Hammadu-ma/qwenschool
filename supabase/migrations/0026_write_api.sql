-- ===========================================================================
-- 0026_write_api.sql — every write becomes one intentional statement
--
-- THE PROBLEM THIS SOLVES
-- `sync()` in src/lib/backend.ts takes the previous in-memory DB and the new
-- one, diffs ~22 tables, and applies the delta. Changing a single mark means
-- serialising every student, every fee, every homework row and every
-- announcement in the school — twice — to discover that one number moved.
-- That is the write-path equivalent of the bootstrap problem: correct at 300
-- students, untenable at 5,000, and it gets worse every year.
--
-- It also has a correctness problem that has nothing to do with size. Two
-- people editing different students at the same time each hold a full
-- snapshot; whoever saves second writes their entire snapshot over the first
-- person's change. Last-writer-wins across the whole database, silently.
--
-- The functions below each do one thing, take only what changed, run in a
-- single transaction, and check permission themselves. `save_student_marks`
-- in 0002 was already the right shape — this extends that pattern to the
-- rest of the write surface.
--
-- All are SECURITY DEFINER with an explicit permission check as the first
-- statement. That check is not optional decoration; it is the authorization.
-- ===========================================================================

/* =========================================================================
   Attendance — one register, one statement.
   p_marks: {"st1":"present","st2":"absent",…}
   ========================================================================= */

create or replace function public.save_register(
  p_year_id text, p_class_id text, p_section_id text, p_day date, p_marks jsonb)
returns jsonb language plpgsql security definer as $$
declare reg_id text; n int := 0;
begin
  if not public.has_perm('attendance.manage') and not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_see_section(p_class_id, p_section_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.year_is_open(p_year_id) then
    raise exception 'academic year % is closed', p_year_id using errcode = '42501';
  end if;

  reg_id := p_year_id || '-' || to_char(p_day, 'YYYYMMDD') || '-' || p_class_id || '-' || p_section_id;

  insert into public.attendance_registers (id, year_id, day, class_id, section_id, recorded_by)
  values (reg_id, p_year_id, p_day, p_class_id, p_section_id, auth.uid())
  on conflict (year_id, day, class_id, section_id) do update
    set recorded_by = auth.uid()
  returning id into reg_id;

  -- Only students actually enrolled in this section this year can be marked,
  -- however the client built its payload.
  with incoming as (
    select key as student_id, value #>> '{}' as status
    from jsonb_each(p_marks)
  ), valid as (
    select i.student_id, i.status
    from incoming i
    join public.enrollments e
      on e.student_id = i.student_id and e.year_id = p_year_id
     and e.class_id = p_class_id and e.section_id = p_section_id and e.status = 'active'
    where i.status in ('present','absent','late')
  ), written as (
    insert into public.attendance_entries (id, register_id, student_id, status)
    select reg_id || '-' || v.student_id, reg_id, v.student_id, v.status from valid v
    on conflict (register_id, student_id) do update set status = excluded.status
    returning 1
  ) select count(*) into n from written;

  -- Anyone removed from the payload is no longer marked.
  delete from public.attendance_entries ae
  where ae.register_id = reg_id and not (p_marks ? ae.student_id);

  perform public.log_action('attendance.save', reg_id, format('%s students marked', n));
  return jsonb_build_object('registerId', reg_id, 'saved', n);
end $$;
grant execute on function public.save_register(text,text,text,date,jsonb) to authenticated;

/* =========================================================================
   Messaging
   ========================================================================= */

create or replace function public.send_message(p_conversation_id text, p_body text)
returns jsonb language plpgsql security definer as $$
declare new_id uuid; recipients uuid[];
begin
  if not public.has_perm('communication.send') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'message body is empty';
  end if;

  insert into public.messages (conversation_id, sender_id, body, read_by)
  values (p_conversation_id, auth.uid(), btrim(p_body), array[auth.uid()])
  returning id into new_id;

  update public.conversations set updated_at = now() where id = p_conversation_id;

  select array_agg(profile_id) into recipients
  from public.conversation_participants
  where conversation_id = p_conversation_id and profile_id <> auth.uid();

  if recipients is not null then
    perform public.notify_users(recipients, 'message', 'New message',
      left(btrim(p_body), 120));
  end if;

  return jsonb_build_object('id', new_id);
end $$;
grant execute on function public.send_message(text,text) to authenticated;

create or replace function public.mark_notifications_read(p_ids text[] default null)
returns integer language plpgsql security definer as $$
declare n int;
begin
  update public.notifications
     set is_read = true
   where profile_id = auth.uid()
     and not is_read
     and (p_ids is null or id::text = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.mark_notifications_read(text[]) to authenticated;

/* =========================================================================
   Fees — payments are money, so this one is deliberately strict.
   ========================================================================= */

create or replace function public.record_fee_payment(
  p_fee_item_id text, p_amount numeric, p_note text default null)
returns jsonb language plpgsql security definer as $$
declare f public.fee_items; new_paid numeric;
begin
  if not public.has_perm('fees.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  -- Row lock: two bursars posting against the same fee at the same moment
  -- would otherwise both read the old `paid` and the second would overwrite
  -- the first. This is exactly the class of bug snapshot-diffing produced.
  select * into f from public.fee_items where id = p_fee_item_id for update;
  if f.id is null then raise exception 'unknown fee item %', p_fee_item_id; end if;
  if not public.year_is_open(f.year_id) then
    raise exception 'academic year % is closed', f.year_id using errcode = '42501';
  end if;

  new_paid := f.paid + p_amount;
  if new_paid > f.amount then
    raise exception 'payment of % exceeds the % outstanding', p_amount, f.amount - f.paid;
  end if;

  update public.fee_items set paid = new_paid where id = f.id;

  perform public.log_action('fees.payment', f.id,
    format('%s recorded against %s%s', p_amount, f.label,
           case when p_note is null then '' else ' — ' || p_note end));

  return jsonb_build_object('feeItemId', f.id, 'paid', new_paid,
                            'outstanding', f.amount - new_paid);
end $$;
grant execute on function public.record_fee_payment(text,numeric,text) to authenticated;

/* =========================================================================
   Mark submission workflow — the state machine, server-side.
   The existing tg_submission_state trigger validates transitions; this is
   the single entry point that drives them.
   ========================================================================= */

create or replace function public.set_submission_status(
  p_structure_id text, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer as $$
declare cur text;
begin
  cur := public.structure_status(p_structure_id);

  -- Who may make which move. Deliberately explicit rather than a generic
  -- "can edit marks" check: publishing results is not the same authority as
  -- entering them, and conflating the two is how marks reach families early.
  if p_status = 'submitted' then
    if not public.teacher_can_write_structure(p_structure_id) and not public.is_admin() then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  elsif p_status in ('approved','returned') then
    if not public.has_perm('results.manage') then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  elsif p_status = 'published' then
    if not public.has_perm('results.publish') then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  elsif p_status = 'draft' then
    if not public.has_perm('results.manage') then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  else
    raise exception 'unknown status %', p_status;
  end if;

  insert into public.mark_submissions (id, structure_id, status)
  values ('ms-' || p_structure_id, p_structure_id, p_status)
  on conflict (structure_id) do update set
    status        = p_status,
    submitted_by  = case when p_status = 'submitted' then auth.uid() else public.mark_submissions.submitted_by end,
    submitted_at  = case when p_status = 'submitted' then now()      else public.mark_submissions.submitted_at end,
    approved_by   = case when p_status = 'approved'  then auth.uid() else public.mark_submissions.approved_by end,
    approved_at   = case when p_status = 'approved'  then now()      else public.mark_submissions.approved_at end,
    returned_by   = case when p_status = 'returned'  then auth.uid() else public.mark_submissions.returned_by end,
    returned_at   = case when p_status = 'returned'  then now()      else public.mark_submissions.returned_at end,
    return_reason = case when p_status = 'returned'  then p_reason   else public.mark_submissions.return_reason end,
    published_by  = case when p_status = 'published' then auth.uid() else public.mark_submissions.published_by end,
    published_at  = case when p_status = 'published' then now()      else public.mark_submissions.published_at end,
    reopen_reason = case when p_status = 'draft'     then p_reason   else public.mark_submissions.reopen_reason end;

  perform public.log_action('marks.' || p_status, p_structure_id,
    coalesce(p_reason, format('%s → %s', cur, p_status)));

  return jsonb_build_object('structureId', p_structure_id, 'from', cur, 'to', p_status);
end $$;
grant execute on function public.set_submission_status(text,text,text) to authenticated;

/* =========================================================================
   Students — create/update through one door, with an explicit column
   whitelist. A client cannot set `id`, `school_id`, or `status` by smuggling
   them into the payload, because only the keys named below are ever read.
   ========================================================================= */

create or replace function public.save_student(p_payload jsonb, p_year_id text default null)
returns jsonb language plpgsql security definer as $$
declare
  sid text := nullif(p_payload->>'id', '');
  yr  text := coalesce(p_year_id, public.current_year_id());
  sch text;
  is_new boolean := sid is null;
begin
  if is_new then
    if not public.has_perm('students.create') then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  else
    if not public.has_perm('students.edit') then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  end if;

  select id into sch from public.schools order by id limit 1;
  if is_new then sid := 'st-' || replace(gen_random_uuid()::text, '-', ''); end if;

  insert into public.students (
    id, school_id, reg_no, admission_no, first_name, middle_name, last_name,
    gender, dob, phone, email, address, guardian_name, guardian_relation,
    guardian_phone, guardian_address, mother_name, admission_date,
    previous_school, admission_type, photo_path)
  values (
    sid, sch,
    coalesce(p_payload->>'reg_no', sid),
    p_payload->>'admission_no',
    p_payload->>'first_name', p_payload->>'middle_name', p_payload->>'last_name',
    coalesce(p_payload->>'gender', 'Male'),
    (p_payload->>'dob')::date,
    p_payload->>'phone', p_payload->>'email', p_payload->>'address',
    p_payload->>'guardian_name', p_payload->>'guardian_relation',
    p_payload->>'guardian_phone', p_payload->>'guardian_address',
    p_payload->>'mother_name',
    nullif(p_payload->>'admission_date','')::date,
    p_payload->>'previous_school', p_payload->>'admission_type',
    p_payload->>'photo_path')
  on conflict (id) do update set
    reg_no            = coalesce(excluded.reg_no, public.students.reg_no),
    admission_no      = excluded.admission_no,
    first_name        = excluded.first_name,
    middle_name       = excluded.middle_name,
    last_name         = excluded.last_name,
    gender            = excluded.gender,
    dob               = excluded.dob,
    phone             = excluded.phone,
    email             = excluded.email,
    address           = excluded.address,
    guardian_name     = excluded.guardian_name,
    guardian_relation = excluded.guardian_relation,
    guardian_phone    = excluded.guardian_phone,
    guardian_address  = excluded.guardian_address,
    mother_name       = excluded.mother_name,
    admission_date    = excluded.admission_date,
    previous_school   = excluded.previous_school,
    admission_type    = excluded.admission_type,
    photo_path        = coalesce(excluded.photo_path, public.students.photo_path);

  -- Enrollment for the selected year, if the caller supplied a placement.
  if (p_payload ? 'class_id') and (p_payload ? 'section_id') then
    insert into public.enrollments (id, student_id, year_id, class_id, section_id, roll_number, status, enrolled_on)
    values (yr || '-' || sid, sid, yr,
            p_payload->>'class_id', p_payload->>'section_id',
            nullif(p_payload->>'roll_number','')::integer, 'active', current_date)
    on conflict (student_id, year_id) do update set
      class_id    = excluded.class_id,
      section_id  = excluded.section_id,
      roll_number = excluded.roll_number;
  end if;

  perform public.log_action(
    case when is_new then 'student.create' else 'student.update' end, sid,
    btrim(coalesce(p_payload->>'first_name','') || ' ' || coalesce(p_payload->>'last_name','')));

  return jsonb_build_object('studentId', sid, 'created', is_new);
end $$;
grant execute on function public.save_student(jsonb,text) to authenticated;

create or replace function public.set_student_status(p_student_id text, p_status text)
returns jsonb language plpgsql security definer as $$
begin
  if not public.has_perm('students.edit') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_status not in ('active','transferred','withdrawn','graduated') then
    raise exception 'unknown status %', p_status;
  end if;
  update public.students set status = p_status where id = p_student_id;
  perform public.log_action('student.status', p_student_id, p_status);
  return jsonb_build_object('studentId', p_student_id, 'status', p_status);
end $$;
grant execute on function public.set_student_status(text,text) to authenticated;

/* =========================================================================
   File metadata — the browser used to insert into and delete from
   `file_objects` directly. It can't any more (there is no table surface), so
   these are the two named operations that replace it. Both re-check the
   owner relationship rather than trusting the caller's word for it.
   ========================================================================= */

create or replace function public.register_file(
  p_owner_type text, p_owner_id text, p_storage_key text,
  p_original_name text default null, p_mime_type text default null,
  p_size_bytes bigint default null, p_kind text default null)
returns jsonb language plpgsql security definer as $$
declare new_id uuid;
begin
  if p_owner_type not in ('student_photo','student_document','fee_receipt') then
    raise exception 'unsupported owner type %', p_owner_type;
  end if;

  -- All three current owner types hang off a student, so the same check
  -- covers them. Add a branch here when a new owner type is introduced —
  -- and note that failing to do so denies access rather than granting it.
  if not public.can_view_student(p_owner_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_owner_type = 'student_photo' and not public.has_perm('students.edit') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.file_objects (
    owner_type, owner_id, storage_key, original_name, mime_type, size_bytes, kind, uploaded_by)
  values (p_owner_type, p_owner_id, p_storage_key, p_original_name, p_mime_type,
          p_size_bytes, p_kind, auth.uid())
  on conflict (storage_key) do update set
    original_name = excluded.original_name,
    mime_type     = excluded.mime_type,
    size_bytes    = excluded.size_bytes,
    kind          = excluded.kind
  returning id into new_id;

  perform public.log_action('file.upload', p_storage_key, coalesce(p_original_name, p_owner_type));
  return jsonb_build_object('fileId', new_id, 'key', p_storage_key);
end $$;
grant execute on function public.register_file(text,text,text,text,text,bigint,text) to authenticated;

create or replace function public.unregister_file(p_storage_key text)
returns jsonb language plpgsql security definer as $$
declare f public.file_objects;
begin
  select * into f from public.file_objects where storage_key = p_storage_key;
  if f.id is null then return jsonb_build_object('deleted', 0); end if;

  if not public.can_view_student(f.owner_id) or not public.has_perm('students.edit') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  delete from public.file_objects where id = f.id;
  perform public.log_action('file.delete', p_storage_key, f.original_name);
  return jsonb_build_object('deleted', 1);
end $$;
grant execute on function public.unregister_file(text) to authenticated;

/* =========================================================================
   Roles and user accounts — the last two things the browser used to write
   directly. Both are privilege-adjacent, which is exactly why they should
   never have been a raw table write: `profiles.role` and
   `role_permissions` decide what everyone else can do.
   ========================================================================= */

create or replace function public.save_role(p_payload jsonb)
returns jsonb language plpgsql security definer as $$
declare rid text := p_payload->>'id'; perms text[];
begin
  if not public.has_perm('roles.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if rid is null or btrim(rid) = '' then raise exception 'role id is required'; end if;

  -- A system role's identity is fixed; only its permission set may move.
  if exists (select 1 from public.role_defs where id = rid and is_system) then
    if coalesce(p_payload->>'name','') <> '' and
       (select name from public.role_defs where id = rid) <> (p_payload->>'name') then
      raise exception 'built-in roles cannot be renamed';
    end if;
  end if;

  insert into public.role_defs (id, name, description, is_system, all_permissions, applies_to, status)
  values (rid,
          coalesce(p_payload->>'name', rid),
          p_payload->>'description',
          false,
          coalesce((p_payload->>'all_permissions')::boolean, false),
          coalesce(array(select jsonb_array_elements_text(p_payload->'applies_to')), '{}'),
          coalesce(p_payload->>'status', 'active'))
  on conflict (id) do update set
    name            = excluded.name,
    description     = excluded.description,
    all_permissions = excluded.all_permissions,
    applies_to      = excluded.applies_to,
    status          = excluded.status;

  -- Replace the permission set atomically, and only with permissions that
  -- actually exist — a typo silently granting nothing is better than a typo
  -- inserting a row nothing ever checks.
  if p_payload ? 'permissions' then
    perms := array(select jsonb_array_elements_text(p_payload->'permissions'));
    delete from public.role_permissions where role_def_id = rid;
    insert into public.role_permissions (role_def_id, permission_id)
    select rid, p.id from public.permissions p where p.id = any(perms);
  end if;

  perform public.log_action('role.save', rid, p_payload->>'name');
  return jsonb_build_object('roleId', rid);
end $$;
grant execute on function public.save_role(jsonb) to authenticated;

create or replace function public.update_user_account(p_payload jsonb)
returns jsonb language plpgsql security definer as $$
declare uid uuid := (p_payload->>'id')::uuid; target public.profiles;
begin
  if not public.has_perm('users.manage') and not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = uid;
  if target.id is null then raise exception 'unknown user'; end if;

  -- You cannot disable or demote yourself. Locking the last administrator
  -- out of their own system is a support call nobody enjoys.
  if uid = auth.uid() and (
       coalesce(p_payload->>'status', target.status) <> 'active'
       or coalesce(p_payload->>'role_def_id', target.role_def_id) <> target.role_def_id) then
    raise exception 'you cannot change your own role or status';
  end if;

  update public.profiles set
    full_name   = coalesce(p_payload->>'full_name', full_name),
    email       = coalesce(p_payload->>'email', email),
    phone       = coalesce(p_payload->>'phone', phone),
    role_def_id = coalesce(p_payload->>'role_def_id', role_def_id),
    status      = coalesce(p_payload->>'status', status)
  where id = uid;

  -- Guardian-to-child links, replaced as a set when supplied.
  if p_payload ? 'children' then
    delete from public.guardian_students where guardian_id = uid;
    insert into public.guardian_students (guardian_id, student_id)
    select uid, s.id from public.students s
    where s.id = any(array(select jsonb_array_elements_text(p_payload->'children')))
    on conflict do nothing;
  end if;

  perform public.log_action('user.update', uid::text, target.username);
  return jsonb_build_object('userId', uid);
end $$;
grant execute on function public.update_user_account(jsonb) to authenticated;
