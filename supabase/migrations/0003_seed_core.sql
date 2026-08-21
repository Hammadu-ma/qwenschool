-- ===========================================================================
-- Riverside SMS — 0003_seed_core.sql
-- Core demo data: school, years, classes, subjects, teachers, assignments,
-- students + enrollments, guardian links, users (Supabase Auth), roles.
-- Idempotent (ON CONFLICT DO NOTHING). Relative dates anchor on now().
-- ===========================================================================

insert into public.schools (id, name, motto)
values ('school-1', 'Riverside Secondary School', 'Knowledge · Discipline · Service')
on conflict (id) do update set name = excluded.name, motto = excluded.motto;

/* ---------------- academic years & terms ---------------- */
insert into public.academic_years (id, school_id, name, start_date, end_date, is_active) values
  ('y25','school-1','2025/26','2025-09-15','2026-07-03',false),
  ('y26','school-1','2026/27','2026-09-14','2027-07-02',true)
on conflict (id) do nothing;

insert into public.terms (id, year_id, name, seq) values
  ('y25-t1','y25','Semester 1',1), ('y25-t2','y25','Semester 2',2), ('y25-ann','y25','Annual',3),
  ('y26-t1','y26','Semester 1',1), ('y26-t2','y26','Semester 2',2), ('y26-ann','y26','Annual',3)
on conflict (id) do nothing;

/* ---------------- classes / sections / subjects / teachers ---------------- */
insert into public.classes (id, school_id, name, level) values
  ('c7','school-1','Grade 7',7), ('c8','school-1','Grade 8',8)
on conflict (id) do nothing;

insert into public.sections (id, class_id, name) values
  ('sec7a','c7','A'), ('sec7b','c7','B'),
  ('sec8a','c8','A'), ('sec8b','c8','B'), ('sec8c','c8','C')
on conflict (id) do nothing;

insert into public.subjects (id, school_id, code, name, color) values
  ('math','school-1','MATH','Mathematics','#2c654c'),
  ('bio','school-1','BIO','Biology','#557d3b'),
  ('eng','school-1','ENG','English','#b07e24'),
  ('phy','school-1','PHY','Physics','#3a6b8c'),
  ('hist','school-1','HIS','History','#96543f')
on conflict (id) do nothing;

insert into public.teachers (id, school_id, name, phone, email, specialty) values
  ('t1','school-1','Mr. Ahmed Yusuf','0911 234 501','ahmed.yusuf@riverside.edu','Mathematics'),
  ('t2','school-1','Ms. Hana Girma','0911 234 502','hana.girma@riverside.edu','Biology'),
  ('t3','school-1','Mr. Ali Omar','0911 234 503','ali.omar@riverside.edu','English'),
  ('t4','school-1','Mrs. Selam Tesfaye','0911 234 504','selam.tesfaye@riverside.edu','Physics'),
  ('t5','school-1','Ms. Meron Alemu','0911 234 506','meron.alemu@riverside.edu','History'),
  ('t6','school-1','Mr. Samuel Tadesse','0911 234 507','samuel.tadesse@riverside.edu','Mathematics')
on conflict (id) do nothing;

/* ---------------- students (permanent records) ---------------- */
-- Seeded through a function: mirrors the app's deterministic generator.
create or replace function public.seed_rnd(i integer, salt integer)
returns double precision language sql immutable as $$
  select (x - floor(x)) from (select sin(i * 127.1 + salt * 311.7) * 43758.5453 as x) t;
$$;

do $$
declare
  r record;
  i integer;
  dob_y integer;
  addr text[] := array['Kebena, Block 4, House 21','Piassa, near Post Office, House 12',
    'Gotera, Condominium B-304','Merkato, Arada sub-city, House 88','Sarbet, House 45',
    'Kazanchis, House 7','Bole, Woreda 03, House 19','Summit, Condominium A-118'];
  fathers text[] := array['Kebede','Alemu','Mohammed','Tesfay','Girma','Mengistu','Tadesse','Solomon'];
  mothers text[] := array['Almaz','Tigist','Fatuma','Wudenesh','Hirut','Meskerem'];
  prev text[] := array['Hope Primary School','Bright Future Academy','Riverside Primary School'];
begin
  for r, i in
    select * from (values
      ( 1,'st1','Abebe','Kebede','Tesema','Male',8), ( 2,'st2','Hana','Alemu','Worku','Female',8),
      ( 3,'st3','Ahmed','Mohammed','Nuru','Male',8), ( 4,'st4','Sara','Tesfay','Gebre','Female',8),
      ( 5,'st5','Yohannes','Girma','Debebe','Male',8), ( 6,'st6','Lulit','Mengistu','Assefa','Female',8),
      ( 7,'st7','Bereket','Tadesse','Lemma','Male',8), ( 8,'st8','Selamawit','Awate','Berhe','Female',8),
      ( 9,'st9','Kalkidan','Fikre','Haile','Female',8),
      (10,'st10','Dawit','Solomon','Ayele','Male',8), (11,'st11','Mariam','Haftu','Kidane','Female',8),
      (12,'st12','Natnael','Zerihun','Getachew','Male',8), (13,'st13','Tigist','Alemayehu','Sisay','Female',8),
      (14,'st14','Robel','Kassa','Mulugeta','Male',8), (15,'st15','Betelhem','Girma','Tefera','Female',8),
      (16,'st16','Eyob','Tesfaye','Aragaw','Male',8), (17,'st17','Rahel','Bekele','Desta','Female',8),
      (18,'st18','Samuel','Fikadu','Gudeta','Male',7), (19,'st19','Hanna','Demissie','Belay','Female',7),
      (20,'st20','Yonas','Kebede','Endale','Male',7), (21,'st21','Feven','Haile','Mariam','Female',7),
      (22,'st22','Abel','Tesfaye','Wondimu','Male',7), (23,'st23','Lidya','Mengistu','Tafari','Female',7)
    ) as t(n, id, fn, mn, ln, g, grade)
  loop
    dob_y := case when r.grade = 8 then 2013 else 2014 end;
    insert into public.students
      (id, school_id, reg_no, admission_no, first_name, middle_name, last_name, gender, dob,
       phone, email, address, status, guardian_name, guardian_relation, guardian_phone, guardian_address,
       mother_name, admission_date, previous_school, admission_type)
    values
      (r.id, 'school-1', 'ST-2026-' || lpad(r.n::text,3,'0'), 'ADM-2026-' || lpad(r.n::text,3,'0'),
       r.fn, r.mn, r.ln, r.g,
       make_date(dob_y, 1 + floor(public.seed_rnd(r.n,3)*11)::int, 1 + floor(public.seed_rnd(r.n,4)*27)::int),
       '09' || lpad((10000000 + floor(public.seed_rnd(r.n,5)*89999999)::bigint)::text, 8, '0'),
       lower(r.fn || '.' || r.ln) || '@student.riverside.edu',
       addr[(r.n % 8) + 1], 'active',
       fathers[(r.n % 8) + 1] || ' ' || r.ln, 'Father',
       '09' || lpad((20000000 + floor(public.seed_rnd(r.n,6)*79999999)::bigint)::text, 8, '0'),
       addr[(r.n % 8) + 1],
       mothers[(r.n % 6) + 1] || ' ' || r.ln,
       (current_date - (45 - (r.n % 9)) * interval '1 day')::date,
       prev[(r.n % 3) + 1], case when r.n % 5 = 0 then 'Transfer' else 'New Admission' end)
    on conflict (id) do nothing;

    insert into public.student_documents (id, student_id, name, kind, size, doc_date)
    values ('doc-' || r.id, r.id, 'Birth certificate.pdf', 'Birth certificate',
            (120 + (r.n % 9) * 37) || ' KB', (current_date - (40 - (r.n % 9)) * interval '1 day')::date)
    on conflict (id) do nothing;
  end loop;
end $$;

/* ---------------- enrollments (history is append-only) ---------------- */
do $$
declare n integer; sid text; sec7 text;
begin
  -- Grade 8B: st1–st9 (y25 in Grade 7, y26 in 8B)
  for n in 1..9 loop
    sid := 'st' || n;
    sec7 := case when (n - 1) % 2 = 0 then 'sec7b' else 'sec7a' end;
    insert into public.enrollments (id, student_id, year_id, class_id, section_id, status, enrolled_on)
    values ('en-' || sid || '-y25', sid, 'y25', 'c7', sec7, 'active', '2025-09-15')
    on conflict (student_id, year_id) do nothing;
    insert into public.enrollments (id, student_id, year_id, class_id, section_id, status, enrolled_on)
    values ('en-' || sid || '-y26', sid, 'y26', 'c8', 'sec8b', 'active', '2026-09-14')
    on conflict (student_id, year_id) do nothing;
  end loop;
  -- Grade 8A: st10–st17
  for n in 10..17 loop
    sid := 'st' || n;
    sec7 := case when (n - 10) % 2 = 0 then 'sec7a' else 'sec7b' end;
    insert into public.enrollments (id, student_id, year_id, class_id, section_id, status, enrolled_on)
    values ('en-' || sid || '-y25', sid, 'y25', 'c7', sec7, 'active', '2025-09-15')
    on conflict (student_id, year_id) do nothing;
    insert into public.enrollments (id, student_id, year_id, class_id, section_id, status, enrolled_on)
    values ('en-' || sid || '-y26', sid, 'y26', 'c8', 'sec8a', 'active', '2026-09-14')
    on conflict (student_id, year_id) do nothing;
  end loop;
  -- Grade 7A: st18–st23 (current year only)
  for n in 18..23 loop
    sid := 'st' || n;
    insert into public.enrollments (id, student_id, year_id, class_id, section_id, status, enrolled_on)
    values ('en-' || sid || '-y26', sid, 'y26', 'c7', 'sec7a', 'active', '2026-09-14')
    on conflict (student_id, year_id) do nothing;
  end loop;
end $$;

/* ---------------- teacher assignments (scope = security) ---------------- */
do $$
declare
  aid integer := 0;
  pair record; sub record;
  tid text;
begin
  for pair in select * from (values ('c8','sec8a'), ('c8','sec8b'), ('c8','sec8c'), ('c7','sec7a')) as t(c, s) loop
    for sub in select id from public.subjects order by id loop
      aid := aid + 1;
      tid := case when sub.id = 'math' and pair.c = 'c8' and pair.s = 'sec8a' then 't6'
                  else (select t2.id from (values ('math','t1'),('bio','t2'),('eng','t3'),('phy','t4'),('hist','t5')) as t2(s2,t2id)
                        where t2.s2 = sub.id limit 1) end;
      insert into public.teacher_assignments (id, year_id, class_id, section_id, subject_id, teacher_id)
      values ('as' || aid, 'y26', pair.c, pair.s, sub.id, tid)
      on conflict (id) do nothing;
    end loop;
  end loop;
end $$;

/* ---------------- roles, permissions, role↔permission mapping ---------------- */
insert into public.permissions (id, name, description, category) values
 ('students.view','View students','Browse the student register.','Students'),
 ('students.view_assigned','View assigned students','See only students in classes/sections this user teaches.','Students'),
 ('students.view_self','View own record','See one''s own student profile.','Students'),
 ('students.view_children','View children','See only registered children.','Students'),
 ('students.create','Register students','Create new student records.','Students'),
 ('students.edit','Edit students','Modify student records.','Students'),
 ('students.delete','Delete students','Remove student records.','Students'),
 ('teachers.view','View teachers','Browse the teaching staff.','Staff'),
 ('teachers.manage','Manage teachers','Add, edit and assign teachers.','Staff'),
 ('academics.view','View academics','See classes, timetable and syllabus.','Academics'),
 ('academics.manage','Manage academics','Edit classes, sections and assignments.','Academics'),
 ('homework.manage','Manage homework','Set and grade homework.','Academics'),
 ('homework.view','View homework','See assigned homework.','Academics'),
 ('assignments.view','View assignments','See teacher–subject assignments.','Academics'),
 ('exams.view','View exams','See examinations and components.','Exams & Marks'),
 ('exams.manage','Manage exams','Create and schedule examinations.','Exams & Marks'),
 ('exams.enter_marks','Enter marks','Record marks for assigned subjects.','Exams & Marks'),
 ('results.view','View results','Browse results for accessible students.','Results'),
 ('results.view_self','View own results','See one''s own results.','Results'),
 ('results.view_children','View children''s results','See results of registered children.','Results'),
 ('results.manage','Manage results','Review and approve results.','Results'),
 ('results.publish','Publish results','Release results to students and families.','Results'),
 ('attendance.view','View attendance','See attendance registers.','Attendance'),
 ('attendance.view_children','View children''s attendance','See attendance of registered children.','Attendance'),
 ('attendance.manage','Take attendance','Record attendance registers.','Attendance'),
 ('fees.view','View fees','See fee ledgers.','Fees'),
 ('fees.manage','Manage fees','Record payments and adjust fees.','Fees'),
 ('communication.view','View communication','Read announcements, messages and notifications.','Communication'),
 ('communication.send','Send messages','Send one-to-one messages (still relationship-checked).','Communication'),
 ('communication.create_announcement','Create announcements','Compose announcements for permitted audiences.','Communication'),
 ('communication.manage_announcement','Manage announcements','Edit, publish or archive any announcement.','Communication'),
 ('communication.moderate','Moderate communication','Review reported messages and conversations.','Communication'),
 ('communication.delete','Delete communication','Remove announcements or conversations.','Communication'),
 ('communication.school_wide','School-wide announcements','Address the entire school.','Communication'),
 ('communication.message_teacher','Message teachers','Open conversations with teachers.','Communication'),
 ('communication.message_student','Message students','Open conversations with students.','Communication'),
 ('communication.message_parent','Message families','Open conversations with parents/guardians.','Communication'),
 ('communication.message_admin','Message administration','Open conversations with the school office.','Communication'),
 ('events.view','View events','See the school calendar.','Events'),
 ('events.manage','Manage events','Create and edit calendar events.','Events'),
 ('users.manage','Manage users','Create accounts and assign roles.','System'),
 ('roles.manage','Manage roles & permissions','Create roles and change permission sets.','System'),
 ('audit.view','View audit log','Read the security/activity audit trail.','System'),
 ('settings.manage','Manage settings','Change school settings.','System')
on conflict (id) do nothing;

insert into public.role_defs (id, name, description, is_system, all_permissions, applies_to, status) values
 ('superadmin','Super Admin','Full system access, including role & permission management.',true,true,array['admin'],'active'),
 ('admin','School Administrator','School-wide administration across all modules.',true,false,array['admin'],'active'),
 ('coordinator','Academic Coordinator','Manages academic activities and results, without user/role administration.',false,false,array['admin','teacher'],'active'),
 ('teacher','Teacher','Academic and communication access for assigned classes and students.',true,false,array['teacher'],'active'),
 ('student','Student','Access to own academic information and permitted communication.',true,false,array['student'],'active'),
 ('guardian','Parent / Family','Access to registered children and their communication.',true,false,array['guardian'],'active')
on conflict (id) do nothing;

do $$
declare
  all_perms text[];
  admin_perms text[];
begin
  select array_agg(id) into all_perms from public.permissions;
  admin_perms := array_remove(all_perms, 'roles.manage');

  insert into public.role_permissions (role_def_id, permission_id)
  select 'admin', unnest(admin_perms) on conflict do nothing;

  insert into public.role_permissions (role_def_id, permission_id)
  select 'coordinator', unnest(array[
    'students.view','students.view_assigned','students.edit','teachers.view',
    'academics.view','academics.manage','assignments.view',
    'exams.view','exams.manage','exams.enter_marks',
    'results.view','results.manage','results.publish',
    'attendance.view','attendance.manage',
    'communication.view','communication.send','communication.create_announcement',
    'communication.message_teacher','communication.message_student','communication.message_parent','communication.message_admin',
    'events.view','events.manage']) on conflict do nothing;

  insert into public.role_permissions (role_def_id, permission_id)
  select 'teacher', unnest(array[
    'students.view_assigned','teachers.view',
    'academics.view','homework.manage','homework.view','assignments.view',
    'exams.view','exams.enter_marks','results.view',
    'attendance.view','attendance.manage',
    'communication.view','communication.send',
    'communication.message_student','communication.message_parent','communication.message_admin',
    'events.view']) on conflict do nothing;

  insert into public.role_permissions (role_def_id, permission_id)
  select 'student', unnest(array[
    'students.view_self','academics.view','homework.view','assignments.view',
    'exams.view','results.view_self','attendance.view',
    'communication.view','communication.send',
    'communication.message_teacher','communication.message_admin','events.view']) on conflict do nothing;

  insert into public.role_permissions (role_def_id, permission_id)
  select 'guardian', unnest(array[
    'students.view_children','academics.view','homework.view','assignments.view',
    'results.view_children','attendance.view_children',
    'communication.view','communication.send',
    'communication.message_teacher','communication.message_admin','events.view']) on conflict do nothing;
end $$;

/* ---------------- auth users + profiles ---------------- */
-- Demo logins map username → username@riverside.school.
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
  -- Write only the columns this project's auth schema actually has
  -- (audit_info / is_anonymous / is_sso_user vary across GoTrue versions).
  cols := 'instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, '
       || 'raw_app_meta_data, raw_user_meta_data, created_at, updated_at, '
       || 'confirmation_token, recovery_token';
  vals := format(
    '%L, %L, %L, %L, %L, crypt(%L, gen_salt(''bf'')), now() - %s * interval ''1 day'', '
    || '%L, jsonb_build_object(''username'', %L), now() - %s * interval ''1 day'', now(), '''', ''''',
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, pw, created_days_ago,
    '{"provider":"email","providers":["email"]}', uname, created_days_ago);
  foreach c in array array['audit_info', 'is_anonymous', 'is_sso_user'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = c
    ) then
      cols := cols || ', ' || c;
      vals := vals || case c when 'audit_info' then ', ''{}''::jsonb' else ', false' end;
    end if;
  end loop;
  execute format('insert into auth.users (%s) values (%s) on conflict (id) do nothing', cols, vals);

  insert into auth.identities
    (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', email),
         'email', uid::text, now(), now(), now()
  where not exists (select 1 from auth.identities where user_id = uid and provider = 'email');

  insert into public.profiles
    (id, school_id, username, full_name, email, role, role_def_id, status, teacher_id, student_id, created_at)
  values
    (uid, 'school-1', uname, full_name, email, base_role, role_def, status, teacher_id, student_id,
     now() - created_days_ago * interval '1 day')
  on conflict (id) do nothing;

  foreach c in array children loop
    insert into public.guardian_students (guardian_id, student_id, relation)
    values (uid, c, 'Father')
    on conflict do nothing;
  end loop;
end $$;

do $$
begin
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000001', 'root',   'root'  || '123', 'Dr. Selam Bekele',  'admin',   'superadmin', null, null, 'active', 500);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000002', 'admin',  'admin' || '123', 'Amara Tesfaye',   'admin',   'admin',      null, null, 'active', 400);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000003', 'lydia',  'coord' || '123', 'Ms. Lydia Fikre', 'admin',   'coordinator',null, null, 'active', 250);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000004', 'ahmed',  'teach' || '123', 'Mr. Ahmed Yusuf', 'teacher', 'teacher',    't1', null, 'active', 320);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000005', 'hana.g', 'teach' || '123', 'Ms. Hana Girma',  'teacher', 'teacher',    't2', null, 'active', 320);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000006', 'ali',    'teach' || '123', 'Mr. Ali Omar',    'teacher', 'teacher',    't3', null, 'disabled', 300);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000007', 'abebe',  'stud'  || '123', 'Abebe Kebede',    'student', 'student',    null, 'st1', 'active', 45);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000008', 'hana.a', 'stud'  || '123', 'Hana Alemu',      'student', 'student',    null, 'st2', 'active', 45);
  perform public.seed_login('7d0a0000-0000-4000-8000-000000000009', 'kebede', 'fam'   || '123', 'Kebede Tesema',   'guardian','guardian',   null, null, 'active', 45, array['st1','st2']);
  perform public.seed_login('7d0a0000-0000-4000-8000-00000000000a', 'almaz',  'fam'   || '123', 'Almaz Worku',     'guardian','guardian',   null, null, 'active', 40, array['st3']);
end $$;
