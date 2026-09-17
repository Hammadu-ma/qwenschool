-- ===========================================================================
-- 0022_performance.sql — make the tables that grow answer in milliseconds
--
-- Sizing assumption behind every index here: ~5,000 students, ~200 school
-- days a year, ~12 subjects. That is roughly
--     attendance_entries  1,000,000 rows / year
--     assessment_marks      600,000 rows / year
--     fee_items              40,000 rows / year
-- Postgres handles that comfortably — but only if every query can start from
-- an index on (year_id, …) instead of scanning the whole table.
--
-- Every index below is `if not exists` and creates no locks worth worrying
-- about on an empty or small database. On a database that is already large,
-- run this migration with CONCURRENTLY (see the note at the bottom).
-- ===========================================================================

create extension if not exists pg_trgm;

/* ---------------- students & enrollment ---------------- */

-- The single most important index in the system: "students in this section,
-- this year". Drives class lists, mark entry, attendance, report cards.
create index if not exists ix_enroll_year_section_status
  on public.enrollments (year_id, class_id, section_id, status)
  include (student_id, roll_number);

-- "which years has this student been enrolled in" — student history page.
create index if not exists ix_enroll_student_year
  on public.enrollments (student_id, year_id);

-- Roll-number ordering inside a section without a sort step.
create index if not exists ix_enroll_section_roll
  on public.enrollments (year_id, class_id, section_id, roll_number);

-- Fuzzy name search that stays fast at 50k students. Trigram index means
-- `name ilike '%abe%'` uses an index instead of scanning every row.
create index if not exists ix_students_name_trgm
  on public.students using gin (
    (coalesce(first_name,'') || ' ' || coalesce(middle_name,'') || ' ' || coalesce(last_name,'')) gin_trgm_ops
  );

create index if not exists ix_students_regno_trgm
  on public.students using gin (reg_no gin_trgm_ops);

create index if not exists ix_students_school_status
  on public.students (school_id, status);

/* ---------------- attendance — the biggest table ---------------- */

create index if not exists ix_att_entries_student_year
  on public.attendance_entries (student_id, year_id)
  include (status);

create index if not exists ix_att_entries_register
  on public.attendance_entries (register_id);

create index if not exists ix_att_reg_year_day
  on public.attendance_registers (year_id, day desc);

create index if not exists ix_att_reg_year_section_day
  on public.attendance_registers (year_id, class_id, section_id, day desc);

/* ---------------- marks & assessment ---------------- */

create index if not exists ix_marks_student_year
  on public.assessment_marks (student_id, year_id);

create index if not exists ix_marks_item
  on public.assessment_marks (item_id);

create index if not exists ix_structures_year_class_subject
  on public.assessment_structures (year_id, class_id, subject_id);

create index if not exists ix_structures_year_term
  on public.assessment_structures (year_id, term_id);

create index if not exists ix_submissions_status
  on public.mark_submissions (status);

create index if not exists ix_mark_audit_year_at
  on public.mark_audit (year_id, at desc);

/* ---------------- fees ---------------- */

create index if not exists ix_fees_year_student
  on public.fee_items (year_id, student_id);

-- Partial index for the query the bursar actually runs all day: who owes money.
create index if not exists ix_fees_outstanding
  on public.fee_items (year_id, due_date)
  where paid < amount;

/* ---------------- timetable, homework, assignments ---------------- */

create index if not exists ix_timetable_year_section
  on public.timetable_entries (year_id, class_id, section_id, day, period);

create index if not exists ix_homework_year_section_due
  on public.homework (year_id, class_id, section_id, due desc);

create index if not exists ix_assignments_year_section
  on public.teacher_assignments (year_id, class_id, section_id);

/* ---------------- communication ---------------- */

-- Keyset pagination on a conversation: "50 messages before this timestamp".
create index if not exists ix_messages_conv_created_desc
  on public.messages (conversation_id, created_at desc);

create index if not exists ix_conversations_year_updated
  on public.conversations (year_id, updated_at desc);

-- Unread badge: partial index so it stays small no matter how much history
-- accumulates.
create index if not exists ix_notifications_unread
  on public.notifications (profile_id, created_at desc)
  where not is_read;

create index if not exists ix_announcements_year_published
  on public.announcements (year_id, published_at desc)
  where status = 'published';

create index if not exists ix_events_year_day
  on public.events (year_id, day);

/* ---------------- profiles & audit ---------------- */

create index if not exists ix_profiles_student on public.profiles (student_id) where student_id is not null;
create index if not exists ix_profiles_teacher on public.profiles (teacher_id) where teacher_id is not null;
create index if not exists ix_profiles_school_role on public.profiles (school_id, role, status);

create index if not exists ix_audit_year_at on public.audit_log (year_id, at desc);

/* =========================================================================
   Planner statistics.

   year_id, class_id and section_id are heavily correlated — a section only
   exists inside one class, and most queries filter on all three. Without
   this, Postgres multiplies the selectivities and badly underestimates row
   counts, which is how you end up with a nested loop over a million rows.
   ========================================================================= */

do $$ begin
  if not exists (select 1 from pg_statistic_ext where stxname = 'st_enroll_year_class_section') then
    create statistics st_enroll_year_class_section (dependencies, ndistinct)
      on year_id, class_id, section_id from public.enrollments;
  end if;
  if not exists (select 1 from pg_statistic_ext where stxname = 'st_att_entries_year_student') then
    create statistics st_att_entries_year_student (dependencies, ndistinct)
      on year_id, student_id from public.attendance_entries;
  end if;
  if not exists (select 1 from pg_statistic_ext where stxname = 'st_marks_year_structure') then
    create statistics st_marks_year_structure (dependencies, ndistinct)
      on year_id, structure_id, student_id from public.assessment_marks;
  end if;
end $$;

analyze public.enrollments;
analyze public.students;
analyze public.attendance_entries;
analyze public.assessment_marks;

-- ---------------------------------------------------------------------------
-- Note for an already-large production database:
-- `create index` takes a write lock on the table for its duration. On a live
-- system with millions of attendance rows, run each index separately as
--     create index concurrently if not exists <name> on …;
-- outside a transaction block, rather than running this file as one unit.
-- On a fresh or small database, running this file as-is is fine.
-- ---------------------------------------------------------------------------
