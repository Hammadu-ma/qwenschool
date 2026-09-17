-- ===========================================================================
-- 0023_scoped_bootstrap.sql — each role loads only its own data
--
-- WHY THIS EXISTS
-- 0012_fast_bootstrap.sql was a real improvement (dozens of HTTP round trips
-- collapsed into one) but it kept a fatal property: `get_app_bootstrap()`
-- selects EVERY student, EVERY profile, EVERY homework row, EVERY timetable
-- entry, for EVERY year, on EVERY login. RLS trims what a student or
-- guardian sees, so their payload stays small — but an admin or teacher at a
-- 3,000-student school downloads several megabytes of JSON before the first
-- pixel paints, and it grows every single year the school operates.
--
-- The replacement below is bounded by design:
--   * always scoped to ONE academic year
--   * shaped by the caller's role — a teacher gets their sections, not the
--     school; an admin gets counts, not 3,000 student rows
--   * the unbounded collections (students, attendance, marks, fees, messages)
--     are NOT in the payload at all. They are paged, on demand, by the
--     functions in 0024_paged_queries.sql.
--
-- A login payload here is a few tens of kilobytes whether the school has 50
-- students or 50,000. get_app_bootstrap() and get_app_snapshot() are left in
-- place so nothing breaks mid-migration, but both are marked deprecated.
-- ===========================================================================

/* =========================================================================
   1. Who am I, and what may I do — one round trip, no table scans.
   ========================================================================= */

create or replace function public.my_permissions()
returns text[] language sql security definer stable as $$
  select case
    when r.all_permissions then array(select id from public.permissions)
    else coalesce(array(
      select rp.permission_id from public.role_permissions rp
      where rp.role_def_id = r.id
    ), '{}')
  end
  from public.profiles p
  join public.role_defs r on r.id = p.role_def_id
  where p.id = auth.uid() and p.status = 'active';
$$;
grant execute on function public.my_permissions() to authenticated;

-- The caller's data boundary, resolved once on the server instead of being
-- recomputed in the browser from a full copy of the school's assignments.
create or replace function public.my_scope(p_year_id text default null)
returns jsonb language plpgsql security definer stable as $$
declare
  me public.profiles;
  yr text := coalesce(p_year_id, public.current_year_id());
  out jsonb;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if me.id is null then
    return jsonb_build_object('role', null, 'yearId', yr);
  end if;

  out := jsonb_build_object(
    'profileId',   me.id,
    'role',        me.role,
    'roleDefId',   me.role_def_id,
    'yearId',      yr,
    'permissions', to_jsonb(public.my_permissions())
  );

  if me.role = 'teacher' then
    out := out || jsonb_build_object(
      'teacherId', me.teacher_id,
      -- exactly the class/section/subject triples this teacher is assigned
      -- in this year, and nothing else
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'classId', ta.class_id, 'sectionId', ta.section_id, 'subjectId', ta.subject_id))
        from public.teacher_assignments ta
        where ta.teacher_id = me.teacher_id and ta.year_id = yr
      ), '[]'::jsonb),
      'studentCount', (
        select count(*) from public.enrollments e
        where e.year_id = yr and e.status = 'active'
          and exists (select 1 from public.teacher_assignments ta
                      where ta.teacher_id = me.teacher_id and ta.year_id = yr
                        and ta.class_id = e.class_id and ta.section_id = e.section_id)
      )
    );

  elsif me.role = 'student' then
    out := out || jsonb_build_object(
      'studentId', me.student_id,
      'enrollment', (
        select to_jsonb(x) from (
          select e.year_id, e.class_id, e.section_id, e.roll_number, e.status
          from public.enrollments e
          where e.student_id = me.student_id and e.year_id = yr
        ) x
      )
    );

  elsif me.role = 'guardian' then
    out := out || jsonb_build_object(
      'childIds', coalesce((
        select jsonb_agg(g.student_id) from public.guardian_students g
        where g.guardian_id = me.id
      ), '[]'::jsonb),
      'children', coalesce((
        select jsonb_agg(jsonb_build_object(
          'studentId', e.student_id, 'classId', e.class_id,
          'sectionId', e.section_id, 'rollNumber', e.roll_number))
        from public.enrollments e
        join public.guardian_students g on g.student_id = e.student_id
        where g.guardian_id = me.id and e.year_id = yr
      ), '[]'::jsonb)
    );
  end if;

  return out;
end $$;
grant execute on function public.my_scope(text) to authenticated;

/* =========================================================================
   2. Reference data — small, shared, cacheable for a long time.
      Classes, sections, subjects, terms, grading scale. A few hundred rows
      at any school size, and it changes maybe twice a year.
   ========================================================================= */

create or replace function public.get_reference(p_year_id text default null)
returns jsonb language sql security invoker stable as $$
  with yr as (select coalesce(p_year_id, public.current_year_id()) as id)
  select jsonb_build_object(
    'yearId',  (select id from yr),
    'school',  (select to_jsonb(s) from public.schools s limit 1),
    'years',   coalesce((select jsonb_agg(to_jsonb(x) order by x.start_date desc)
                         from (select id, name, start_date, end_date, is_active
                               from public.academic_years) x), '[]'::jsonb),
    'terms',   coalesce((select jsonb_agg(to_jsonb(x) order by x.seq)
                         from (select id, year_id, name, seq from public.terms
                               where year_id = (select id from yr)) x), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(to_jsonb(x) order by x.level)
                         from (select id, name, level from public.classes) x), '[]'::jsonb),
    'sections',coalesce((select jsonb_agg(to_jsonb(x))
                         from (select id, class_id, name from public.sections) x), '[]'::jsonb),
    'subjects',coalesce((select jsonb_agg(to_jsonb(x))
                         from (select id, name, code, color from public.subjects) x), '[]'::jsonb),
    'grading', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort)
                         from (select min_pct, max_pct, grade, remark, sort
                               from public.grade_bands
                               where year_id = (select id from yr)) x), '[]'::jsonb),
    'roleDefs',coalesce((select jsonb_agg(to_jsonb(x))
                         from (select id, name, description, is_system, all_permissions,
                                      applies_to, status from public.role_defs) x), '[]'::jsonb)
  );
$$;
grant execute on function public.get_reference(text) to authenticated;

/* =========================================================================
   3. The bootstrap itself — reference + scope + a role-appropriate slice.

      Note what is NOT here: students, attendance, marks, fees, messages,
      audit. Those are paged. This payload's size is a function of the
      caller's role, not of the school's size.
   ========================================================================= */

create or replace function public.get_bootstrap(p_year_id text default null)
returns jsonb language plpgsql security invoker stable as $$
declare
  yr    text := coalesce(p_year_id, public.current_year_id());
  scope jsonb := public.my_scope(yr);
  role  text := scope->>'role';
  out   jsonb;
begin
  out := jsonb_build_object(
    'yearId',    yr,
    'scope',     scope,
    'reference', public.get_reference(yr),
    'profile',   (select to_jsonb(x) from (
                    select id, full_name, username, role, role_def_id, status,
                           email, phone, teacher_id, student_id
                    from public.profiles where id = auth.uid()) x),
    'unread',    (select count(*) from public.notifications
                   where profile_id = auth.uid() and not is_read)
  );

  if role = 'admin' then
    -- Counts, not rows. The admin dashboard needs totals; the people page
    -- pages through list_students() when the user actually opens it.
    out := out || jsonb_build_object('summary', jsonb_build_object(
      'students',   (select count(*) from public.enrollments where year_id = yr and status = 'active'),
      'teachers',   (select count(*) from public.teachers),
      'staff',      (select count(*) from public.profiles where status = 'active'),
      'sections',   (select count(distinct (class_id, section_id)) from public.enrollments where year_id = yr),
      'feesBilled', (select coalesce(sum(amount), 0) from public.fee_items where year_id = yr),
      'feesPaid',   (select coalesce(sum(paid), 0)   from public.fee_items where year_id = yr),
      'pendingMarkApprovals', (
        select count(*) from public.mark_submissions ms
        join public.assessment_structures s on s.id = ms.structure_id
        where s.year_id = yr and ms.status = 'submitted')
    ));

  elsif role = 'teacher' then
    -- Their timetable and their assessment structures only. Bounded by how
    -- many sections one human teaches — a couple of dozen rows.
    out := out || jsonb_build_object(
      'timetable', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select t.id, t.class_id, t.section_id, t.day, t.period, t.subject_id, t.room
          from public.timetable_entries t
          where t.year_id = yr and exists (
            select 1 from public.teacher_assignments ta
            where ta.teacher_id = (scope->>'teacherId') and ta.year_id = yr
              and ta.class_id = t.class_id and ta.section_id = t.section_id
              and ta.subject_id = t.subject_id)) x), '[]'::jsonb),
      'structures', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select s.id, s.year_id, s.class_id, s.subject_id, s.term_id,
                 coalesce(ms.status, 'draft') as status
          from public.assessment_structures s
          left join public.mark_submissions ms on ms.structure_id = s.id
          where s.year_id = yr and public.teacher_can_write_structure(s.id)) x), '[]'::jsonb)
    );

  elsif role = 'student' then
    out := out || jsonb_build_object(
      'timetable', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select t.id, t.class_id, t.section_id, t.day, t.period, t.subject_id, t.room
          from public.timetable_entries t
          join public.enrollments e
            on e.year_id = t.year_id and e.class_id = t.class_id and e.section_id = t.section_id
          where t.year_id = yr and e.student_id = (scope->>'studentId')) x), '[]'::jsonb),
      'fees', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select id, label, amount, paid, due_date, term_id
          from public.fee_items
          where year_id = yr and student_id = (scope->>'studentId')) x), '[]'::jsonb)
    );

  elsif role = 'guardian' then
    out := out || jsonb_build_object(
      'fees', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select f.id, f.student_id, f.label, f.amount, f.paid, f.due_date, f.term_id
          from public.fee_items f
          join public.guardian_students g on g.student_id = f.student_id
          where f.year_id = yr and g.guardian_id = auth.uid()) x), '[]'::jsonb),
      'children', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select s.id, s.reg_no, s.first_name, s.middle_name, s.last_name,
                 s.photo_path, e.class_id, e.section_id, e.roll_number
          from public.students s
          join public.guardian_students g on g.student_id = s.id
          left join public.enrollments e on e.student_id = s.id and e.year_id = yr
          where g.guardian_id = auth.uid()) x), '[]'::jsonb)
    );
  end if;

  return out;
end $$;
grant execute on function public.get_bootstrap(text) to authenticated;

/* =========================================================================
   4. Mark the old entry points deprecated. They still work — nothing in the
      existing frontend breaks the moment this migration lands — but they
      should not be called once src/lib/api.ts is wired in.
   ========================================================================= */

comment on function public.get_app_bootstrap() is
  'DEPRECATED (0023): unbounded — returns every student/profile/homework row for every year. Use get_bootstrap(year_id) plus the paged list_* functions.';
comment on function public.get_app_snapshot() is
  'DEPRECATED (0023): full-table dump, intended only for the rare recovery resync. Never call on login.';
