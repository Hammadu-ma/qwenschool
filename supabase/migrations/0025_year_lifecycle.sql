-- ===========================================================================
-- 0025_year_lifecycle.sql — what was missing: how a school STARTS a new year
--
-- Once every record is tied to an academic year, the obvious next question is
-- the one the schema had no answer for: what happens in September? Today an
-- administrator would have to hand-create a new year and then re-enter every
-- teacher assignment, every timetable slot, every assessment structure, every
-- grade band, and re-enroll every student one at a time. At 3,000 students
-- that is not a feature gap, it is a reason the system gets abandoned.
--
-- This migration adds:
--   * fee_templates          — define a fee once per class, not once per child
--   * set_active_year()      — safe, audited switch of the active year
--   * rollover_year()        — copy a year's *structure* into the next one
--   * promote_students()     — move enrollments up a level, graduate the top
--   * apply_fee_template()   — bill a whole class in one statement
--   * close_year()           — freeze a finished year against further edits
-- ===========================================================================

/* =========================================================================
   1. Fee templates — the missing layer between "a fee exists" and
      "3,000 fee_items rows".
   ========================================================================= */

create table if not exists public.fee_templates (
  id          text primary key,
  year_id     text not null references public.academic_years(id) on delete cascade,
  class_id    text references public.classes(id) on delete cascade,  -- null = all classes
  term_id     text references public.terms(id) on delete set null,
  label       text not null,
  amount      numeric(10,2) not null check (amount >= 0),
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (year_id, class_id, term_id, label)
);
create index if not exists ix_fee_templates_year on public.fee_templates (year_id, class_id);

alter table public.fee_items add column if not exists template_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_fee_items_template') then
    alter table public.fee_items
      add constraint fk_fee_items_template foreign key (template_id)
      references public.fee_templates(id) on delete set null;
  end if;
end $$;
-- A student is billed for a given template exactly once.
create unique index if not exists uq_fee_item_student_template
  on public.fee_items (student_id, template_id) where template_id is not null;

alter table public.fee_templates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'fee_templates_sel') then
    create policy fee_templates_sel on public.fee_templates for select to authenticated
      using (public.has_perm('fees.view') or public.is_admin());
    create policy fee_templates_wri on public.fee_templates for all to authenticated
      using (public.has_perm('fees.manage')) with check (public.has_perm('fees.manage'));
  end if;
end $$;

drop trigger if exists trg_updated_at on public.fee_templates;
create trigger trg_updated_at before update on public.fee_templates
for each row execute function public.set_updated_at();

-- Same year/term consistency guard the fee items get.
drop trigger if exists trg_fee_template_term_year on public.fee_templates;
create trigger trg_fee_template_term_year before insert or update on public.fee_templates
for each row execute function public.tg_check_term_year();

/* =========================================================================
   2. A year can be closed. A closed year is history — readable forever,
      not editable by accident.
   ========================================================================= */

alter table public.academic_years add column if not exists status text not null default 'open';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'academic_years_status_check') then
    alter table public.academic_years
      add constraint academic_years_status_check check (status in ('planned','open','closed'));
  end if;
end $$;

create or replace function public.year_is_open(p_year_id text)
returns boolean language sql security definer stable as $$
  select coalesce((select status <> 'closed' from public.academic_years where id = p_year_id), false);
$$;
grant execute on function public.year_is_open(text) to authenticated;

-- Block writes into a closed year on the tables that carry real records.
-- A null year_id means the row's year has not been resolved yet (see the
-- inherit trigger in 0021, which runs first by name). Nothing to guard in
-- that case — let it through rather than rejecting a legitimate write.
create or replace function public.tg_block_closed_year()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'DELETE' then
    if old.year_id is not null and not public.year_is_open(old.year_id) then
      raise exception 'academic year % is closed', old.year_id using errcode = '42501';
    end if;
    return old;
  end if;
  if new.year_id is not null and not public.year_is_open(new.year_id) then
    raise exception 'academic year % is closed', new.year_id using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'enrollments','attendance_registers','attendance_entries','assessment_marks',
    'fee_items','homework','timetable_entries','teacher_assignments','assessment_structures'
  ] loop
    execute format(
      'drop trigger if exists trg_block_closed_year on public.%I;
       create trigger trg_block_closed_year before insert or update or delete on public.%I
       for each row execute function public.tg_block_closed_year();', t, t);
  end loop;
end $$;

/* =========================================================================
   3. Switching the active year.
   ========================================================================= */

create or replace function public.set_active_year(p_year_id text)
returns void language plpgsql security definer as $$
declare sid text;
begin
  if not public.has_perm('academics.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select school_id into sid from public.academic_years where id = p_year_id;
  if sid is null then raise exception 'unknown academic year %', p_year_id; end if;

  -- The partial unique index allows only one active year per school, so the
  -- old one must be cleared before the new one is set.
  update public.academic_years set is_active = false where school_id = sid and is_active;
  update public.academic_years set is_active = true, status = 'open' where id = p_year_id;

  perform public.log_action('year.activate', p_year_id, 'Active academic year switched');
end $$;
grant execute on function public.set_active_year(text) to authenticated;

create or replace function public.close_year(p_year_id text)
returns void language plpgsql security definer as $$
begin
  if not public.has_perm('academics.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if (select is_active from public.academic_years where id = p_year_id) then
    raise exception 'cannot close the active year — activate the next year first';
  end if;
  update public.academic_years set status = 'closed' where id = p_year_id;
  perform public.log_action('year.close', p_year_id, 'Academic year closed to further edits');
end $$;
grant execute on function public.close_year(text) to authenticated;

/* =========================================================================
   4. Rollover — copy a year's STRUCTURE (not its records) into a new year.

      Copied:    teacher assignments, timetable, grade bands, assessment
                 structures + items, fee templates.
      Not copied: marks, attendance, fees, homework, messages. Those are the
                 previous year's record and stay there.
   ========================================================================= */

create or replace function public.rollover_year(
  p_from_year text,
  p_to_year   text,
  p_copy_assignments boolean default true,
  p_copy_timetable   boolean default true,
  p_copy_structures  boolean default true,
  p_copy_fees        boolean default true
)
returns jsonb language plpgsql security definer as $$
declare
  n_assign int := 0; n_time int := 0; n_struct int := 0;
  n_items int := 0; n_bands int := 0; n_fees int := 0;
  term_map jsonb := '{}'::jsonb;
begin
  if not public.has_perm('academics.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_from_year = p_to_year then raise exception 'source and target year are the same'; end if;
  if not exists (select 1 from public.academic_years where id = p_from_year) then
    raise exception 'unknown source year %', p_from_year; end if;
  if not public.year_is_open(p_to_year) then
    raise exception 'target year % is closed', p_to_year; end if;

  -- Terms are matched by sequence number, so "Term 1" maps to "Term 1".
  select coalesce(jsonb_object_agg(f.id, t.id), '{}'::jsonb) into term_map
  from public.terms f
  join public.terms t on t.year_id = p_to_year and t.seq = f.seq
  where f.year_id = p_from_year;

  if p_copy_assignments then
    insert into public.teacher_assignments (id, year_id, class_id, section_id, subject_id, teacher_id)
    select p_to_year || '-' || md5(a.class_id || a.section_id || a.subject_id),
           p_to_year, a.class_id, a.section_id, a.subject_id, a.teacher_id
    from public.teacher_assignments a
    where a.year_id = p_from_year
    on conflict (year_id, class_id, section_id, subject_id) do nothing;
    get diagnostics n_assign = row_count;
  end if;

  if p_copy_timetable then
    insert into public.timetable_entries (id, year_id, class_id, section_id, day, period, subject_id, room)
    select p_to_year || '-tt-' || md5(t.class_id || t.section_id || t.day || t.period),
           p_to_year, t.class_id, t.section_id, t.day, t.period, t.subject_id, t.room
    from public.timetable_entries t
    where t.year_id = p_from_year
    on conflict do nothing;
    get diagnostics n_time = row_count;
  end if;

  -- Grade bands: the grading scale almost never changes between years, and a
  -- year with no bands renders every report card as "—".
  insert into public.grade_bands (id, school_id, year_id, min_pct, max_pct, grade, remark, sort)
  select p_to_year || '-gb-' || g.sort, g.school_id, p_to_year,
         g.min_pct, g.max_pct, g.grade, g.remark, g.sort
  from public.grade_bands g
  where g.year_id = p_from_year
  on conflict do nothing;
  get diagnostics n_bands = row_count;

  if p_copy_structures then
    insert into public.assessment_structures (id, year_id, class_id, subject_id, term_id)
    select p_to_year || '-as-' || md5(s.class_id || s.subject_id || coalesce(s.term_id,'')),
           p_to_year, s.class_id, s.subject_id, (term_map->>s.term_id)
    from public.assessment_structures s
    where s.year_id = p_from_year
      and (s.term_id is null or term_map ? s.term_id)
    on conflict (year_id, class_id, subject_id, term_id) do nothing;
    get diagnostics n_struct = row_count;

    -- The items (Quiz 1, Midterm, Final…) that make each structure meaningful.
    insert into public.assessment_items (id, structure_id, name, max_mark, weight, sort)
    select md5(ns.id || i.name || i.sort), ns.id, i.name, i.max_mark, i.weight, i.sort
    from public.assessment_structures os
    join public.assessment_items i on i.structure_id = os.id
    join public.assessment_structures ns
      on ns.year_id = p_to_year and ns.class_id = os.class_id
     and ns.subject_id = os.subject_id
     and ns.term_id is not distinct from (term_map->>os.term_id)
    where os.year_id = p_from_year
    on conflict do nothing;
    get diagnostics n_items = row_count;
  end if;

  if p_copy_fees then
    insert into public.fee_templates (id, year_id, class_id, term_id, label, amount, due_date)
    select p_to_year || '-ft-' || md5(coalesce(f.class_id,'*') || f.label),
           p_to_year, f.class_id, (term_map->>f.term_id), f.label, f.amount, null
    from public.fee_templates f
    where f.year_id = p_from_year
    on conflict (year_id, class_id, term_id, label) do nothing;
    get diagnostics n_fees = row_count;
  end if;

  perform public.log_action('year.rollover', p_to_year,
    format('Structure copied from %s', p_from_year));

  return jsonb_build_object(
    'fromYear', p_from_year, 'toYear', p_to_year,
    'assignments', n_assign, 'timetable', n_time, 'gradeBands', n_bands,
    'structures', n_struct, 'assessmentItems', n_items, 'feeTemplates', n_fees);
end $$;
grant execute on function public.rollover_year(text,text,boolean,boolean,boolean,boolean) to authenticated;

/* =========================================================================
   5. Promotion — move students up a class level in the new year.

      Set-based: one statement for the whole school, not 3,000 round trips.
      Idempotent: enrollments has unique (student_id, year_id), so re-running
      a promotion cannot duplicate anyone.
   ========================================================================= */

create or replace function public.promote_students(
  p_from_year text,
  p_to_year   text,
  p_class_id  text default null,          -- null = whole school
  p_graduate_top boolean default true     -- top level leaves rather than repeating
)
returns jsonb language plpgsql security definer as $$
declare
  n_promoted int := 0; n_graduated int := 0; top_level int;
begin
  if not public.has_perm('students.edit') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.year_is_open(p_to_year) then
    raise exception 'target year % is closed', p_to_year; end if;

  select max(level) into top_level from public.classes;

  -- Everyone below the top level moves into the class one level up, keeping
  -- their section name where that section exists in the new class.
  with moved as (
    insert into public.enrollments (id, student_id, year_id, class_id, section_id, roll_number, status, enrolled_on)
    select p_to_year || '-' || e.student_id, e.student_id, p_to_year,
           nc.id,
           coalesce(
             (select ns.id from public.sections ns
               join public.sections os on os.id = e.section_id
              where ns.class_id = nc.id and ns.name = os.name),
             (select ns.id from public.sections ns where ns.class_id = nc.id order by ns.name limit 1)
           ),
           e.roll_number, 'active', current_date
    from public.enrollments e
    join public.classes c  on c.id = e.class_id
    join public.classes nc on nc.level = c.level + 1
    where e.year_id = p_from_year
      and e.status = 'active'
      and (p_class_id is null or e.class_id = p_class_id)
      and (not p_graduate_top or c.level < top_level)
      and not exists (select 1 from public.enrollments x
                      where x.student_id = e.student_id and x.year_id = p_to_year)
    returning 1
  ) select count(*) into n_promoted from moved;

  if p_graduate_top then
    with grad as (
      update public.students s set status = 'graduated'
      where s.status = 'active' and exists (
        select 1 from public.enrollments e
        join public.classes c on c.id = e.class_id
        where e.student_id = s.id and e.year_id = p_from_year
          and e.status = 'active' and c.level = top_level
          and (p_class_id is null or e.class_id = p_class_id))
      returning 1
    ) select count(*) into n_graduated from grad;
  end if;

  perform public.log_action('year.promote', p_to_year,
    format('%s promoted, %s graduated from %s', n_promoted, n_graduated, p_from_year));

  return jsonb_build_object('promoted', n_promoted, 'graduated', n_graduated,
                            'fromYear', p_from_year, 'toYear', p_to_year);
end $$;
grant execute on function public.promote_students(text,text,text,boolean) to authenticated;

/* =========================================================================
   6. Billing a whole class from a template — one statement, any size.
   ========================================================================= */

create or replace function public.apply_fee_template(p_template_id text)
returns jsonb language plpgsql security definer as $$
declare t public.fee_templates; n int := 0;
begin
  if not public.has_perm('fees.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into t from public.fee_templates where id = p_template_id;
  if t.id is null then raise exception 'unknown fee template %', p_template_id; end if;
  if not public.year_is_open(t.year_id) then
    raise exception 'academic year % is closed', t.year_id; end if;

  with billed as (
    insert into public.fee_items (id, student_id, year_id, term_id, label, amount, paid, due_date, template_id)
    select md5(t.id || e.student_id), e.student_id, t.year_id, t.term_id,
           t.label, t.amount, 0, t.due_date, t.id
    from public.enrollments e
    where e.year_id = t.year_id
      and e.status = 'active'
      and (t.class_id is null or e.class_id = t.class_id)
    on conflict (student_id, template_id) do nothing
    returning 1
  ) select count(*) into n from billed;

  perform public.log_action('fees.bill', t.id, format('%s students billed for %s', n, t.label));
  return jsonb_build_object('templateId', t.id, 'billed', n);
end $$;
grant execute on function public.apply_fee_template(text) to authenticated;

/* =========================================================================
   7. Creating the next year in one call, so the console has something to
      point at.
   ========================================================================= */

create or replace function public.create_academic_year(
  p_id text, p_name text, p_start date, p_end date, p_terms text[] default array['Term 1','Term 2','Term 3'])
returns jsonb language plpgsql security definer as $$
declare sid text; i int;
begin
  if not public.has_perm('academics.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select id into sid from public.schools order by id limit 1;

  insert into public.academic_years (id, school_id, name, start_date, end_date, is_active, status)
  values (p_id, sid, p_name, p_start, p_end, false, 'planned')
  on conflict (id) do nothing;

  for i in 1 .. coalesce(array_length(p_terms, 1), 0) loop
    insert into public.terms (id, year_id, name, seq)
    values (p_id || '-t' || i, p_id, p_terms[i], i)
    on conflict (year_id, name) do nothing;
  end loop;

  perform public.log_action('year.create', p_id, p_name);
  return jsonb_build_object('yearId', p_id, 'terms', coalesce(array_length(p_terms, 1), 0));
end $$;
grant execute on function public.create_academic_year(text,text,date,date,text[]) to authenticated;
