-- ===========================================================================
-- Riverside School Management System — 0001_schema.sql
-- Relational core. Text PKs preserve the application's existing identifiers
-- (st1, sec8b, as-bio8s1 …); uuid PKs are reserved for auth-linked and
-- high-churn rows (profiles, messages, notifications, audit).
-- Idempotent: safe to re-run. Never drops data.
-- ===========================================================================

create extension if not exists pgcrypto;

/* ---------------- school & academic calendar ---------------- */

create table if not exists public.schools (
  id          text primary key,
  name        text not null,
  motto       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.academic_years (
  id          text primary key,
  school_id   text not null references public.schools(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date > start_date)
);
-- Only one active year at a time.
create unique index if not exists uq_one_active_year
  on public.academic_years (school_id) where is_active;

create table if not exists public.terms (
  id          text primary key,
  year_id     text not null references public.academic_years(id) on delete cascade,
  name        text not null,
  seq         integer not null default 0,
  unique (year_id, name)
);

/* ---------------- structure: classes / sections / subjects ---------------- */

create table if not exists public.classes (
  id          text primary key,
  school_id   text not null references public.schools(id) on delete cascade,
  name        text not null,
  level       integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.sections (
  id          text primary key,
  class_id    text not null references public.classes(id) on delete cascade,
  name        text not null,
  unique (class_id, name)
);

create table if not exists public.subjects (
  id          text primary key,
  school_id   text not null references public.schools(id) on delete cascade,
  code        text not null,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, code)
);

create table if not exists public.teachers (
  id          text primary key,
  school_id   text not null references public.schools(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  specialty   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

/* ---------------- people ---------------- */

create table if not exists public.students (
  id              text primary key,
  school_id       text not null references public.schools(id) on delete cascade,
  reg_no          text not null,
  admission_no    text,
  first_name      text not null,
  middle_name     text,
  last_name       text not null,
  gender          text not null check (gender in ('Male','Female')),
  dob             date not null,
  phone           text,
  email           text,
  address         text,
  status          text not null default 'active'
                  check (status in ('active','transferred','withdrawn','graduated')),
  guardian_name   text,
  guardian_relation text,
  guardian_phone  text,
  guardian_address text,
  mother_name     text,
  admission_date  date,
  previous_school text,
  admission_type  text,
  photo_path      text,            -- Storage: profile-photos/{student_id}/photo
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, reg_no)
);

-- One permanent student record; enrollments are the per-year history.
create table if not exists public.enrollments (
  id            text primary key,
  student_id    text not null references public.students(id) on delete cascade,
  year_id       text not null references public.academic_years(id) on delete cascade,
  class_id      text not null references public.classes(id) on delete cascade,
  section_id    text not null references public.sections(id) on delete cascade,
  roll_number   integer,
  status        text not null default 'active'
                check (status in ('active','transferred','withdrawn')),
  enrolled_on   date,
  created_at    timestamptz not null default now(),
  unique (student_id, year_id)
);
create index if not exists ix_enrollments_student on public.enrollments (student_id);
create index if not exists ix_enrollments_section on public.enrollments (year_id, class_id, section_id);

create table if not exists public.student_documents (
  id            text primary key,
  student_id    text not null references public.students(id) on delete cascade,
  name          text not null,
  kind          text,
  size          text,
  doc_date      date,
  storage_path  text,               -- Storage: student-documents/{student_id}/…
  created_at    timestamptz not null default now()
);
create index if not exists ix_student_documents_student on public.student_documents (student_id);

/* ---------------- roles / permissions / profiles ---------------- */

create table if not exists public.permissions (
  id            text primary key,   -- e.g. 'marks.enter'
  name          text not null,
  description   text,
  category      text not null
);

create table if not exists public.role_defs (
  id              text primary key, -- 'superadmin', 'admin', 'coordinator', …
  name            text not null,
  description     text,
  is_system       boolean not null default false,
  all_permissions boolean not null default false,  -- true ⇒ '*'
  applies_to      text[] not null default '{}',
  status          text not null default 'active' check (status in ('active','disabled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_def_id   text not null references public.role_defs(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  primary key (role_def_id, permission_id)
);

-- 1:1 with auth.users. The role lives HERE (server-side), never client-supplied.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  school_id     text references public.schools(id),
  username      text not null,
  full_name     text not null,
  email         text,
  phone         text,
  role          text not null check (role in ('admin','teacher','student','guardian')),
  role_def_id   text not null references public.role_defs(id),
  status        text not null default 'active' check (status in ('active','disabled')),
  teacher_id    text references public.teachers(id),
  student_id    text references public.students(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (username),
  check ( (role <> 'teacher') or (teacher_id is not null) ),
  check ( (role <> 'student') or (student_id is not null) )
);
create index if not exists ix_profiles_role on public.profiles (role);

-- Guardian ↔ student is many-to-many (a guardian may have several children,
-- a student may have several guardians).
create table if not exists public.guardian_students (
  guardian_id   uuid not null references public.profiles(id) on delete cascade,
  student_id    text not null references public.students(id) on delete cascade,
  relation      text not null default 'Guardian',
  primary key (guardian_id, student_id)
);
create index if not exists ix_guardian_students_student on public.guardian_students (student_id);

/* ---------------- teaching assignments ---------------- */

create table if not exists public.teacher_assignments (
  id            text primary key,
  year_id       text not null references public.academic_years(id) on delete cascade,
  class_id      text not null references public.classes(id) on delete cascade,
  section_id    text not null references public.sections(id) on delete cascade,
  subject_id    text not null references public.subjects(id) on delete cascade,
  teacher_id    text not null references public.teachers(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (year_id, class_id, section_id, subject_id)
);
create index if not exists ix_assignments_teacher on public.teacher_assignments (teacher_id, year_id);

/* ---------------- timetable / homework ---------------- */

create table if not exists public.timetable_entries (
  id            text primary key,
  class_id      text not null references public.classes(id) on delete cascade,
  section_id    text not null references public.sections(id) on delete cascade,
  day           integer not null check (day between 0 and 6),
  period        integer not null check (period between 1 and 12),
  subject_id    text not null references public.subjects(id) on delete cascade,
  room          text,
  unique (class_id, section_id, day, period)
);

create table if not exists public.homework (
  id            text primary key,
  year_id       text not null references public.academic_years(id) on delete cascade,
  class_id      text not null references public.classes(id) on delete cascade,
  section_id    text not null references public.sections(id) on delete cascade,
  subject_id    text not null references public.subjects(id) on delete cascade,
  title         text not null,
  description   text,
  issued        date not null,
  due           date not null,
  submitted_students text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

/* ---------------- assessment system ---------------- */

create table if not exists public.assessment_structures (
  id            text primary key,
  year_id       text not null references public.academic_years(id) on delete cascade,
  class_id      text not null references public.classes(id) on delete cascade,
  subject_id    text not null references public.subjects(id) on delete cascade,
  term_id       text references public.terms(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (year_id, class_id, subject_id, term_id)
);

create table if not exists public.assessment_items (
  id            text primary key,
  structure_id  text not null references public.assessment_structures(id) on delete cascade,
  name          text not null,
  max_mark      numeric(6,2) not null check (max_mark > 0),
  weight        numeric(5,2) not null check (weight > 0),
  sort          integer not null default 0
);
create index if not exists ix_assessment_items_structure on public.assessment_items (structure_id);

create table if not exists public.assessment_marks (
  id            text primary key,
  structure_id  text not null references public.assessment_structures(id) on delete cascade,
  item_id       text not null references public.assessment_items(id) on delete cascade,
  student_id    text not null references public.students(id) on delete cascade,
  raw_mark      numeric(6,2) not null check (raw_mark >= 0),
  entered_by    uuid references public.profiles(id),
  entered_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (item_id, student_id)
);
create index if not exists ix_marks_structure_student on public.assessment_marks (structure_id, student_id);

-- Mark workflow: one record per assessment structure.
create table if not exists public.mark_submissions (
  id              text primary key,
  structure_id    text not null references public.assessment_structures(id) on delete cascade,
  status          text not null default 'draft'
                  check (status in ('draft','submitted','approved','published','returned')),
  submitted_by    uuid references public.profiles(id),
  submitted_at    timestamptz,
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  returned_by     uuid references public.profiles(id),
  returned_at     timestamptz,
  return_reason   text,
  published_by    uuid references public.profiles(id),
  published_at    timestamptz,
  reopen_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (structure_id)
);

-- Immutable history of every mark change (never deleted, never overwritten).
create table if not exists public.mark_audit (
  id            uuid primary key default gen_random_uuid(),
  structure_id  text not null,
  item_id       text,
  student_id    text,
  old_value     numeric(6,2),
  new_value     numeric(6,2),
  actor         uuid references public.profiles(id),
  actor_name    text,
  reason        text,
  at            timestamptz not null default now()
);
create index if not exists ix_mark_audit_structure on public.mark_audit (structure_id);

create table if not exists public.grade_bands (
  id            text primary key,
  school_id     text not null references public.schools(id) on delete cascade,
  min_pct       numeric(5,2) not null,
  max_pct       numeric(5,2) not null,
  grade         text not null,
  remark        text,
  sort          integer not null default 0,
  check (max_pct >= min_pct)
);

/* ---------------- attendance / fees ---------------- */

create table if not exists public.attendance_registers (
  id            text primary key,
  day           date not null,
  class_id      text not null references public.classes(id) on delete cascade,
  section_id    text not null references public.sections(id) on delete cascade,
  recorded_by   uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  unique (day, class_id, section_id)
);

create table if not exists public.attendance_entries (
  id            text primary key,
  register_id   text not null references public.attendance_registers(id) on delete cascade,
  student_id    text not null references public.students(id) on delete cascade,
  status        text not null check (status in ('present','absent','late')),
  unique (register_id, student_id)
);
create index if not exists ix_attendance_entries_student on public.attendance_entries (student_id);

create table if not exists public.fee_items (
  id            text primary key,
  student_id    text not null references public.students(id) on delete cascade,
  label         text not null,
  amount        numeric(10,2) not null check (amount >= 0),
  paid          numeric(10,2) not null default 0 check (paid >= 0),
  due_date      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (paid <= amount)
);

/* ---------------- communication ---------------- */

create table if not exists public.announcements (
  id              text primary key,
  title           text not null,
  body            text not null,
  category        text not null,
  sender_id       uuid references public.profiles(id),
  audience        jsonb not null default '{"kind":"everyone"}',
  status          text not null default 'draft'
                  check (status in ('draft','scheduled','published','archived')),
  scheduled_for   timestamptz,
  published_at    timestamptz,
  pinned          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.announcement_reads (
  announcement_id text not null references public.announcements(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

create table if not exists public.conversations (
  id                    text primary key,
  related_student_id    text references public.students(id) on delete set null,
  related_class_id      text references public.classes(id) on delete set null,
  related_section_id    text references public.sections(id) on delete set null,
  related_subject_id    text references public.subjects(id) on delete set null,
  status                text not null default 'active'
                        check (status in ('active','archived','hidden')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id text not null references public.conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, profile_id)
);
create index if not exists ix_conv_participants_profile on public.conversation_participants (profile_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id),
  body            text not null check (char_length(body) > 0),
  read_by         uuid[] not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists ix_messages_conversation on public.messages (conversation_id, created_at);

create table if not exists public.message_reports (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages(id) on delete cascade,
  conversation_id text not null,
  reporter_id     uuid not null references public.profiles(id),
  reason          text not null,
  detail          text,
  status          text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at      timestamptz not null default now()
);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists ix_notifications_profile on public.notifications (profile_id, is_read);

create table if not exists public.events (
  id            text primary key,
  title         text not null,
  description   text,
  day           date not null,
  time_of_day   text,
  location      text,
  category      text not null,
  audience      jsonb not null default '{"kind":"everyone"}',
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

/* ---------------- audit ---------------- */

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id),
  actor_name  text,
  action      text not null,
  target      text,
  detail      text,
  at          timestamptz not null default now()
);
create index if not exists ix_audit_log_at on public.audit_log (at desc);

/* ---------------- housekeeping ---------------- */

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'schools','academic_years','classes','subjects','teachers','students',
    'profiles','role_defs','assessment_structures','assessment_marks',
    'mark_submissions','homework','fee_items','announcements','conversations','events'
  ] loop
    execute format(
      'drop trigger if exists trg_updated_at on public.%I;
       create trigger trg_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;
