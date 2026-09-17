-- ===========================================================================
-- 0024_paged_queries.sql — the tables that grow are never loaded whole
--
-- The current frontend holds one in-memory `DB` object containing every
-- student, every attendance record and every mark, then filters it with
-- Array.prototype.filter. That is O(n) per keystroke in the browser's main
-- thread, and n grows every year the school runs. At a few hundred students
-- it feels fine; at five thousand the search box stutters and the tab uses
-- hundreds of megabytes.
--
-- These functions move filtering, sorting, searching, counting and
-- aggregating into PostgreSQL, where the indexes from 0022 make each one an
-- index scan over a few dozen rows. The browser holds a page at a time.
--
-- SECURITY NOTE — why SECURITY DEFINER here
-- Row Level Security evaluates can_view_student() once PER ROW. For a paged
-- read that is fine, but for `count(*)` over 5,000 students it means 5,000
-- correlated subqueries. These functions instead resolve the caller's scope
-- ONCE, then apply it as a set-based predicate — same boundary, one
-- evaluation. RLS remains enabled on every table underneath, so direct
-- PostgREST access is still governed by 0002's policies; this is a faster
-- road to the same place, not a way around it.
-- ===========================================================================

/* =========================================================================
   Students — paged, searchable, year-scoped, role-scoped.
   Returns total_count alongside each row so the UI can render "1–50 of 4,812"
   without a second round trip.
   ========================================================================= */

create or replace function public.list_students(
  p_year_id    text default null,
  p_class_id   text default null,
  p_section_id text default null,
  p_status     text default 'active',
  p_search     text default null,
  p_sort       text default 'name',      -- 'name' | 'roll' | 'reg'
  p_limit      integer default 50,
  p_offset     integer default 0
)
returns table (
  student_id   text,
  reg_no       text,
  full_name    text,
  first_name   text,
  middle_name  text,
  last_name    text,
  gender       text,
  dob          date,
  photo_path   text,
  status       text,
  class_id     text,
  section_id   text,
  roll_number  integer,
  guardian_phone text,
  total_count  bigint
)
language plpgsql security definer stable as $$
declare
  yr  text := coalesce(p_year_id, public.current_year_id());
  me  public.profiles;
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);  -- hard ceiling
  off integer := greatest(coalesce(p_offset, 0), 0);
  q   text := nullif(btrim(coalesce(p_search, '')), '');
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if me.id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  return query
  with scoped as (
    select e.student_id, e.class_id, e.section_id, e.roll_number, e.status as enroll_status
    from public.enrollments e
    where e.year_id = yr
      and (p_class_id   is null or e.class_id   = p_class_id)
      and (p_section_id is null or e.section_id = p_section_id)
      and (p_status     is null or e.status     = p_status)
      -- ---- the role boundary, applied once ----
      and (
        me.role = 'admin'
        or (me.role = 'student'  and e.student_id = me.student_id)
        or (me.role = 'guardian' and exists (
              select 1 from public.guardian_students g
              where g.guardian_id = me.id and g.student_id = e.student_id))
        or (me.role = 'teacher'  and exists (
              select 1 from public.teacher_assignments ta
              where ta.teacher_id = me.teacher_id and ta.year_id = yr
                and ta.class_id = e.class_id and ta.section_id = e.section_id))
      )
  ),
  matched as (
    select sc.*, s.reg_no, s.first_name, s.middle_name, s.last_name,
           s.gender, s.dob, s.photo_path, s.guardian_phone,
           (coalesce(s.first_name,'') || ' ' || coalesce(s.middle_name,'') || ' ' ||
            coalesce(s.last_name,'')) as fname
    from scoped sc
    join public.students s on s.id = sc.student_id
    where q is null
       or s.reg_no ilike '%' || q || '%'
       or (coalesce(s.first_name,'') || ' ' || coalesce(s.middle_name,'') || ' ' ||
           coalesce(s.last_name,'')) ilike '%' || q || '%'
  ),
  counted as (select count(*) as n from matched)
  select m.student_id, m.reg_no, btrim(regexp_replace(m.fname, '\s+', ' ', 'g')),
         m.first_name, m.middle_name, m.last_name, m.gender, m.dob,
         m.photo_path, m.enroll_status, m.class_id, m.section_id,
         m.roll_number, m.guardian_phone, c.n
  from matched m cross join counted c
  order by
    case when p_sort = 'roll' then m.roll_number end nulls last,
    case when p_sort = 'reg'  then m.reg_no      end,
    case when p_sort = 'name' then m.fname       end,
    m.student_id
  limit lim offset off;
end $$;
grant execute on function public.list_students(text,text,text,text,text,text,integer,integer) to authenticated;

/* =========================================================================
   One student, everything — replaces "filter six in-memory arrays".
   One round trip for the whole student detail page, already aggregated.
   ========================================================================= */

create or replace function public.get_student_detail(p_student_id text, p_year_id text default null)
returns jsonb language plpgsql security invoker stable as $$
declare
  yr text := coalesce(p_year_id, public.current_year_id());
begin
  -- SECURITY INVOKER: a single-row read, so per-row RLS costs nothing and
  -- can_view_student() stays the one authority on who may see this student.
  if not public.can_view_student(p_student_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'student', (select to_jsonb(s) from public.students s where s.id = p_student_id),
    'yearId', yr,
    -- full enrollment history, so "which class was she in two years ago" works
    'enrollments', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.year_id desc) from (
        select e.year_id, e.class_id, e.section_id, e.roll_number, e.status, e.enrolled_on
        from public.enrollments e where e.student_id = p_student_id) x), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, name, kind, size, doc_date, storage_path, year_id
        from public.student_documents where student_id = p_student_id) x), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, label, amount, paid, due_date, term_id
        from public.fee_items
        where student_id = p_student_id and year_id = yr) x), '[]'::jsonb),
    -- aggregated, not one row per school day
    'attendance', (
      select jsonb_build_object(
        'present', count(*) filter (where status = 'present'),
        'absent',  count(*) filter (where status = 'absent'),
        'late',    count(*) filter (where status = 'late'),
        'total',   count(*))
      from public.attendance_entries
      where student_id = p_student_id and year_id = yr),
    'guardians', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select p.id, p.full_name, p.phone, p.email, g.relation
        from public.guardian_students g
        join public.profiles p on p.id = g.guardian_id
        where g.student_id = p_student_id) x), '[]'::jsonb)
  );
end $$;
grant execute on function public.get_student_detail(text,text) to authenticated;

/* =========================================================================
   Marks — one section's sheet for one assessment, in one call.
   Previously the client held every mark in the school to render this.
   ========================================================================= */

create or replace function public.get_marksheet(p_structure_id text)
returns jsonb language plpgsql security invoker stable as $$
declare st public.assessment_structures;
begin
  select * into st from public.assessment_structures where id = p_structure_id;
  if st.id is null then raise exception 'unknown structure %', p_structure_id; end if;

  return jsonb_build_object(
    'structure', to_jsonb(st),
    'status', coalesce((select status from public.mark_submissions where structure_id = st.id), 'draft'),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.sort) from (
        select id, name, max_mark, weight, sort
        from public.assessment_items where structure_id = st.id) x), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.roll_number nulls last, x.full_name) from (
        select s.id as student_id,
               btrim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')) as full_name,
               e.roll_number,
               coalesce((
                 select jsonb_object_agg(m.item_id, m.raw_mark)
                 from public.assessment_marks m
                 where m.structure_id = st.id and m.student_id = s.id), '{}'::jsonb) as marks
        from public.enrollments e
        join public.students s on s.id = e.student_id
        where e.year_id = st.year_id and e.class_id = st.class_id and e.status = 'active') x), '[]'::jsonb)
  );
end $$;
grant execute on function public.get_marksheet(text) to authenticated;

/* =========================================================================
   Attendance — a single day's register, and per-section summaries.
   Never "all attendance".
   ========================================================================= */

create or replace function public.get_register(
  p_year_id text, p_class_id text, p_section_id text, p_day date)
returns jsonb language plpgsql security invoker stable as $$
begin
  if not public.can_see_section(p_class_id, p_section_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'day', p_day, 'yearId', p_year_id, 'classId', p_class_id, 'sectionId', p_section_id,
    'registerId', (select id from public.attendance_registers
                   where year_id = p_year_id and day = p_day
                     and class_id = p_class_id and section_id = p_section_id),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.roll_number nulls last) from (
        select s.id as student_id,
               btrim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')) as full_name,
               e.roll_number,
               (select ae.status from public.attendance_entries ae
                join public.attendance_registers r on r.id = ae.register_id
                where ae.student_id = s.id and r.year_id = p_year_id and r.day = p_day
                  and r.class_id = p_class_id and r.section_id = p_section_id) as status
        from public.enrollments e
        join public.students s on s.id = e.student_id
        where e.year_id = p_year_id and e.class_id = p_class_id
          and e.section_id = p_section_id and e.status = 'active') x), '[]'::jsonb)
  );
end $$;
grant execute on function public.get_register(text,text,text,date) to authenticated;

create or replace function public.get_attendance_summary(
  p_year_id text, p_class_id text default null, p_section_id text default null,
  p_from date default null, p_to date default null)
returns table (student_id text, full_name text, roll_number integer,
               present bigint, absent bigint, late bigint, total bigint, pct numeric)
language plpgsql security definer stable as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if me.id is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  return query
  select s.id,
         btrim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')),
         e.roll_number,
         count(*) filter (where ae.status = 'present'),
         count(*) filter (where ae.status = 'absent'),
         count(*) filter (where ae.status = 'late'),
         count(ae.*),
         case when count(ae.*) = 0 then 0
              else round(100.0 * (count(*) filter (where ae.status = 'present')
                                + 0.5 * count(*) filter (where ae.status = 'late'))
                         / count(ae.*), 1) end
  from public.enrollments e
  join public.students s on s.id = e.student_id
  left join public.attendance_entries ae
         on ae.student_id = e.student_id and ae.year_id = e.year_id
  left join public.attendance_registers r on r.id = ae.register_id
  where e.year_id = p_year_id
    and (p_class_id   is null or e.class_id   = p_class_id)
    and (p_section_id is null or e.section_id = p_section_id)
    and (p_from is null or r.day >= p_from)
    and (p_to   is null or r.day <= p_to)
    and (
      me.role = 'admin'
      or (me.role = 'student'  and e.student_id = me.student_id)
      or (me.role = 'guardian' and exists (select 1 from public.guardian_students g
            where g.guardian_id = me.id and g.student_id = e.student_id))
      or (me.role = 'teacher'  and exists (select 1 from public.teacher_assignments ta
            where ta.teacher_id = me.teacher_id and ta.year_id = e.year_id
              and ta.class_id = e.class_id and ta.section_id = e.section_id))
    )
  group by s.id, s.first_name, s.last_name, e.roll_number
  order by e.roll_number nulls last;
end $$;
grant execute on function public.get_attendance_summary(text,text,text,date,date) to authenticated;

/* =========================================================================
   Fees — paged, with the outstanding filter the bursar actually uses.
   ========================================================================= */

create or replace function public.list_fees(
  p_year_id text default null, p_class_id text default null,
  p_section_id text default null, p_only_outstanding boolean default false,
  p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (fee_id text, student_id text, full_name text, class_id text, section_id text,
               label text, amount numeric, paid numeric, due_date date, term_id text,
               total_count bigint, total_billed numeric, total_paid numeric)
language plpgsql security definer stable as $$
declare
  yr text := coalesce(p_year_id, public.current_year_id());
  me public.profiles;
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if me.id is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  return query
  with rows_ as (
    select f.id, f.student_id, f.label, f.amount, f.paid, f.due_date, f.term_id,
           e.class_id, e.section_id,
           btrim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')) as fname
    from public.fee_items f
    join public.students s on s.id = f.student_id
    left join public.enrollments e on e.student_id = f.student_id and e.year_id = yr
    where f.year_id = yr
      and (p_class_id is null or e.class_id = p_class_id)
      and (p_section_id is null or e.section_id = p_section_id)
      and (not p_only_outstanding or f.paid < f.amount)
      and (q is null or s.reg_no ilike '%'||q||'%'
           or (coalesce(s.first_name,'')||' '||coalesce(s.last_name,'')) ilike '%'||q||'%')
      and (
        me.role = 'admin'
        or (me.role = 'student'  and f.student_id = me.student_id)
        or (me.role = 'guardian' and exists (select 1 from public.guardian_students g
              where g.guardian_id = me.id and g.student_id = f.student_id))
        or (me.role = 'teacher'  and public.has_perm('fees.view') and exists (
              select 1 from public.teacher_assignments ta
              where ta.teacher_id = me.teacher_id and ta.year_id = yr
                and ta.class_id = e.class_id and ta.section_id = e.section_id))
      )
  ),
  agg as (select count(*) n, coalesce(sum(amount),0) b, coalesce(sum(paid),0) p from rows_)
  select r.id, r.student_id, r.fname, r.class_id, r.section_id, r.label,
         r.amount, r.paid, r.due_date, r.term_id, a.n, a.b, a.p
  from rows_ r cross join agg a
  order by (r.amount - r.paid) desc, r.due_date nulls last
  limit lim offset greatest(coalesce(p_offset,0), 0);
end $$;
grant execute on function public.list_fees(text,text,text,boolean,text,integer,integer) to authenticated;

/* =========================================================================
   Messages & notifications — keyset pagination.
   OFFSET gets slower the deeper you page; "everything before this timestamp"
   stays constant-time forever, which is what a chat thread needs.
   ========================================================================= */

create or replace function public.list_messages(
  p_conversation_id text, p_before timestamptz default null, p_limit integer default 50)
returns table (id uuid, sender_id uuid, body text, read_by uuid[], created_at timestamptz)
language sql security invoker stable as $$
  select m.id, m.sender_id, m.body, m.read_by, m.created_at
  from public.messages m
  where m.conversation_id = p_conversation_id
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
grant execute on function public.list_messages(text,timestamptz,integer) to authenticated;

create or replace function public.list_conversations(
  p_year_id text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language sql security invoker stable as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
  from (
    select c.id, c.year_id, c.status, c.updated_at,
           c.related_student_id, c.related_class_id, c.related_section_id, c.related_subject_id,
           (select jsonb_agg(cp.profile_id) from public.conversation_participants cp
             where cp.conversation_id = c.id) as participants,
           (select jsonb_build_object('body', m.body, 'at', m.created_at, 'sender', m.sender_id)
              from public.messages m where m.conversation_id = c.id
             order by m.created_at desc limit 1) as last_message,
           (select count(*) from public.messages m
             where m.conversation_id = c.id and not (auth.uid() = any(m.read_by))) as unread
    from public.conversations c
    where c.year_id = coalesce(p_year_id, public.current_year_id())
      and public.is_conversation_member(c.id)
    order by c.updated_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) x;
$$;
grant execute on function public.list_conversations(text,integer,integer) to authenticated;

create or replace function public.list_notifications(
  p_before timestamptz default null, p_limit integer default 30, p_unread_only boolean default false)
returns table (id uuid, type text, title text, body text, is_read boolean,
               year_id text, created_at timestamptz)
language sql security invoker stable as $$
  select n.id, n.type, n.title, n.body, n.is_read, n.year_id, n.created_at
  from public.notifications n
  where n.profile_id = auth.uid()
    and (p_before is null or n.created_at < p_before)
    and (not p_unread_only or not n.is_read)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
grant execute on function public.list_notifications(timestamptz,integer,boolean) to authenticated;

create or replace function public.list_audit(
  p_year_id text default null, p_before timestamptz default null, p_limit integer default 50)
returns table (id uuid, actor_name text, action text, target text, detail text, at timestamptz)
language sql security invoker stable as $$
  select a.id, a.actor_name, a.action, a.target, a.detail, a.at
  from public.audit_log a
  where (p_year_id is null or a.year_id = p_year_id)
    and (p_before is null or a.at < p_before)
  order by a.at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
grant execute on function public.list_audit(text,timestamptz,integer) to authenticated;
