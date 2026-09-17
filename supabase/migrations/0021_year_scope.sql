-- ===========================================================================
-- 0021_year_scope.sql — every record belongs to an academic year
--
-- 0001_schema.sql scoped only *some* tables by year (enrollments, homework,
-- teacher_assignments, assessment_structures). Everything else floated free:
-- a timetable, an attendance register, a fee item, an event, an announcement
-- or a conversation had no way to say which year it belonged to. That meant
-- "show me last year" was impossible, and every query had to scan all years
-- of history forever.
--
-- This migration closes that gap. It is additive and idempotent: it never
-- drops a table, never deletes a row, and can be re-run safely.
--
-- Two kinds of year_id are added:
--   OWNED     — the row genuinely belongs to a year (timetable, fees, events).
--   INHERITED — the row's year is implied by its parent, but is denormalised
--               onto the row so large tables can be filtered by year without
--               a join (attendance_entries, assessment_marks, mark_audit).
--               A trigger keeps these correct; they are never client-supplied.
-- ===========================================================================

/* ---------------- helper: which year is "now" ---------------- */

create or replace function public.current_year_id()
returns text language sql stable security definer as $$
  select id from public.academic_years
  where is_active
  order by start_date desc
  limit 1;
$$;
comment on function public.current_year_id() is
  'The single active academic year. Used as the default for new rows and as the backfill fallback.';

-- Resolve a date to the year that contains it, falling back to the active year.
create or replace function public.year_for_date(d date)
returns text language sql stable security definer as $$
  select coalesce(
    (select y.id from public.academic_years y
      where d between y.start_date and y.end_date
      order by y.start_date desc limit 1),
    public.current_year_id()
  );
$$;

grant execute on function public.current_year_id() to authenticated;
grant execute on function public.year_for_date(date) to authenticated;

/* =========================================================================
   1. OWNED year_id — the row belongs to a year in its own right
   ========================================================================= */

alter table public.timetable_entries     add column if not exists year_id text;
alter table public.attendance_registers  add column if not exists year_id text;
alter table public.fee_items             add column if not exists year_id text;
alter table public.fee_items             add column if not exists term_id text;
alter table public.events                add column if not exists year_id text;
alter table public.announcements         add column if not exists year_id text;
alter table public.conversations         add column if not exists year_id text;
alter table public.grade_bands           add column if not exists year_id text;

-- Documents and notifications are only *sometimes* year-bound (a birth
-- certificate is not). Nullable on purpose — null means "applies to the
-- student/user, not to a year".
alter table public.student_documents     add column if not exists year_id text;
alter table public.notifications         add column if not exists year_id text;
alter table public.audit_log             add column if not exists year_id text;

/* =========================================================================
   2. INHERITED year_id — denormalised from the parent for fast filtering.
      These are the tables that grow fastest (one row per student per day,
      one row per student per assessment item), so they must be filterable
      by year without joining.
   ========================================================================= */

alter table public.attendance_entries    add column if not exists year_id text;
alter table public.assessment_marks      add column if not exists year_id text;
alter table public.mark_audit            add column if not exists year_id text;
alter table public.enrollments           add column if not exists year_locked boolean not null default false;

/* =========================================================================
   3. BACKFILL — derive the year from the best evidence each row carries,
      falling back to the active year. Only touches rows still null, so
      re-running this migration is a no-op.
   ========================================================================= */

-- Date-bearing rows: use the year whose date range contains them.
update public.attendance_registers set year_id = public.year_for_date(day)          where year_id is null;
update public.events                set year_id = public.year_for_date(day)          where year_id is null;
update public.fee_items             set year_id = public.year_for_date(coalesce(due_date, created_at::date)) where year_id is null;
update public.announcements         set year_id = public.year_for_date(coalesce(published_at, created_at)::date) where year_id is null;
update public.conversations         set year_id = public.year_for_date(created_at::date) where year_id is null;

-- Structure-bearing rows: no date of their own, so they belong to the
-- currently active year.
update public.timetable_entries     set year_id = public.current_year_id() where year_id is null;
update public.grade_bands           set year_id = public.current_year_id() where year_id is null;

-- Inherited: take the parent's year.
update public.attendance_entries e
   set year_id = r.year_id
  from public.attendance_registers r
 where r.id = e.register_id and e.year_id is null;

update public.assessment_marks m
   set year_id = s.year_id
  from public.assessment_structures s
 where s.id = m.structure_id and m.year_id is null;

update public.mark_audit a
   set year_id = s.year_id
  from public.assessment_structures s
 where s.id = a.structure_id and a.year_id is null;

/* =========================================================================
   4. CONSTRAINTS — foreign keys + NOT NULL + defaults.
      NOT NULL is only applied when the backfill left no nulls behind, so a
      database with unexpected data fails loudly at step 3 rather than
      halfway through an ALTER.
   ========================================================================= */

do $$
declare
  t text;
  owned text[] := array[
    'timetable_entries','attendance_registers','fee_items','events',
    'announcements','conversations','grade_bands'
  ];
  inherited text[] := array['attendance_entries','assessment_marks','mark_audit'];
  nullable text[] := array['student_documents','notifications','audit_log'];
  remaining bigint;
begin
  -- Foreign keys for every table that got a year_id.
  foreach t in array owned || inherited || nullable loop
    if not exists (
      select 1 from pg_constraint
      where conname = format('fk_%s_year', t)
        and conrelid = format('public.%I', t)::regclass
    ) then
      execute format(
        'alter table public.%I
           add constraint fk_%s_year foreign key (year_id)
           references public.academic_years(id) on delete cascade', t, t);
    end if;
  end loop;

  -- NOT NULL + default for the tables where a year is mandatory.
  foreach t in array owned || inherited loop
    execute format('select count(*) from public.%I where year_id is null', t) into remaining;
    if remaining = 0 then
      execute format('alter table public.%I alter column year_id set not null', t);
    else
      raise warning
        '0021: % still has % rows with no year_id — left nullable. Assign a year, then re-run.',
        t, remaining;
    end if;
  end loop;

  -- New rows default to the active year so existing INSERT statements in the
  -- app keep working unchanged while the frontend is migrated over.
  foreach t in array owned loop
    execute format('alter table public.%I alter column year_id set default public.current_year_id()', t);
  end loop;
end $$;

-- fee_items.term_id is optional (not every fee is termly).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_fee_items_term') then
    alter table public.fee_items
      add constraint fk_fee_items_term foreign key (term_id)
      references public.terms(id) on delete set null;
  end if;
end $$;

/* =========================================================================
   5. UNIQUENESS now includes the year.

      This is the correctness fix that matters most. Before this, a school
      could not have a timetable for 2025/26 *and* 2026/27 — the second one
      collided with the first on (class, section, day, period). Same for
      attendance: the same calendar day in two different years collided.
   ========================================================================= */

do $$
declare c text;
begin
  -- timetable: old key was (class, section, day, period)
  for c in
    select conname from pg_constraint
    where conrelid = 'public.timetable_entries'::regclass and contype = 'u'
  loop
    execute format('alter table public.timetable_entries drop constraint %I', c);
  end loop;

  for c in
    select conname from pg_constraint
    where conrelid = 'public.attendance_registers'::regclass and contype = 'u'
  loop
    execute format('alter table public.attendance_registers drop constraint %I', c);
  end loop;
end $$;

create unique index if not exists uq_timetable_year_slot
  on public.timetable_entries (year_id, class_id, section_id, day, period);

create unique index if not exists uq_attendance_register_day
  on public.attendance_registers (year_id, day, class_id, section_id);

-- One grade band table per year, ordered.
create unique index if not exists uq_grade_band_year_sort
  on public.grade_bands (year_id, sort);

/* =========================================================================
   6. TRIGGERS — keep inherited year_id honest.

      The client never sets these. Even if a compromised client tried to
      write assessment_marks.year_id = 'some-other-year', the trigger
      overwrites it with the structure's real year before the row lands.
   ========================================================================= */

create or replace function public.tg_inherit_year()
returns trigger language plpgsql security definer as $$
begin
  if tg_table_name = 'attendance_entries' then
    select r.year_id into new.year_id
      from public.attendance_registers r where r.id = new.register_id;
  elsif tg_table_name in ('assessment_marks','mark_audit') then
    select s.year_id into new.year_id
      from public.assessment_structures s where s.id = new.structure_id;
  end if;
  return new;
end $$;

-- NAME MATTERS HERE. PostgreSQL fires BEFORE triggers in alphabetical order,
-- and 0025 adds `trg_block_closed_year` to these same tables. If this trigger
-- sorted after it, the guard would read a year_id that had not been populated
-- yet and reject every legitimate write. The leading `_a_` keeps it first.
do $$
declare t text;
begin
  foreach t in array array['attendance_entries','assessment_marks','mark_audit'] loop
    execute format(
      'drop trigger if exists trg_inherit_year on public.%I;
       drop trigger if exists trg_a_inherit_year on public.%I;
       create trigger trg_a_inherit_year before insert or update on public.%I
       for each row execute function public.tg_inherit_year();', t, t, t);
  end loop;
end $$;

-- A fee item's term must belong to the fee item's year. Cheap guard against
-- the kind of cross-year mismatch that only shows up months later in a report.
create or replace function public.tg_check_term_year()
returns trigger language plpgsql security definer as $$
begin
  if new.term_id is not null and not exists (
    select 1 from public.terms t where t.id = new.term_id and t.year_id = new.year_id
  ) then
    raise exception 'term % does not belong to academic year %', new.term_id, new.year_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_fee_term_year on public.fee_items;
create trigger trg_fee_term_year before insert or update on public.fee_items
for each row execute function public.tg_check_term_year();

-- Same guard for assessment structures, which already had both columns but
-- no constraint tying them together.
drop trigger if exists trg_structure_term_year on public.assessment_structures;
create trigger trg_structure_term_year before insert or update on public.assessment_structures
for each row execute function public.tg_check_term_year();

/* =========================================================================
   7. RLS for the new column — policies already exist on these tables and
      continue to apply. Nothing here widens access; the year_id column is
      just another filterable attribute inside the same policy envelope.
   ========================================================================= */

-- Grade bands were school-wide; now year-scoped. Keep the read policy open
-- to authenticated users (a grading scale is not sensitive) but writes still
-- require results.manage, unchanged from 0002.

comment on column public.attendance_entries.year_id is
  'Denormalised from attendance_registers. Maintained by trigger — never trust a client value.';
comment on column public.assessment_marks.year_id is
  'Denormalised from assessment_structures. Maintained by trigger — never trust a client value.';
