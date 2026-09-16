-- Fast application bootstrap.
-- Keeps authorization in PostgreSQL (SECURITY INVOKER) while reducing the
-- browser from dozens of HTTP requests to one request for the initial shell
-- and one request for the complete snapshot in the background.

create or replace function public.get_app_bootstrap()
returns jsonb
language sql
security invoker
stable
as $$
  select jsonb_build_object(
    'schools', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,motto from public.schools) x), '[]'::jsonb),
    'academic_years', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,start_date,end_date,is_active from public.academic_years) x), '[]'::jsonb),
    'terms', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,year_id,name,seq from public.terms) x), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,level from public.classes) x), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,class_id,name from public.sections) x), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,code,color from public.subjects) x), '[]'::jsonb),
    'teachers', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,phone,email,specialty from public.teachers) x), '[]'::jsonb),
    'teacher_assignments', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,year_id,class_id,section_id,subject_id,teacher_id from public.teacher_assignments) x), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,reg_no,first_name,middle_name,last_name,gender,dob,phone,email,address,photo_path,guardian_name,mother_name,guardian_relation,guardian_phone,guardian_address,admission_no,admission_date,previous_school,admission_type from public.students) x), '[]'::jsonb),
    'enrollments', coalesce((select jsonb_agg(to_jsonb(x)) from (select student_id,year_id,class_id,section_id,roll_number,status,enrolled_on from public.enrollments) x), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,full_name,username,role,role_def_id,status,email,phone,teacher_id,student_id,created_at from public.profiles) x), '[]'::jsonb),
    'guardian_students', coalesce((select jsonb_agg(to_jsonb(x)) from (select guardian_id,student_id from public.guardian_students) x), '[]'::jsonb),
    'timetable_entries', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,class_id,section_id,day,period,subject_id,room from public.timetable_entries) x), '[]'::jsonb),
    'homework', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,year_id,class_id,section_id,subject_id,title,description,issued,due,submitted_students from public.homework) x), '[]'::jsonb),
    'assessment_structures', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,year_id,class_id,subject_id,term_id from public.assessment_structures) x), '[]'::jsonb),
    'assessment_items', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,structure_id,name,max_mark,weight,sort from public.assessment_items) x), '[]'::jsonb),
    'mark_submissions', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,structure_id,status,submitted_by,submitted_at,approved_by,approved_at,returned_by,returned_at,return_reason,published_by,published_at,reopen_reason from public.mark_submissions) x), '[]'::jsonb),
    'attendance_registers', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,day,class_id,section_id,recorded_by from public.attendance_registers) x), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,body,category,sender_id,audience,status,created_at,scheduled_for,published_at,pinned from public.announcements) x), '[]'::jsonb),
    'announcement_reads', coalesce((select jsonb_agg(to_jsonb(x)) from (select announcement_id,profile_id from public.announcement_reads) x), '[]'::jsonb),
    'role_defs', coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,description,is_system,all_permissions,applies_to,status from public.role_defs) x), '[]'::jsonb),
    'role_permissions', coalesce((select jsonb_agg(to_jsonb(x)) from (select role_def_id,permission_id from public.role_permissions) x), '[]'::jsonb)
  );
$$;

grant execute on function public.get_app_bootstrap() to authenticated;

create or replace function public.get_app_snapshot()
returns jsonb
language sql
security invoker
stable
as $$
  select jsonb_build_object(
    'schools', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.schools) x), '[]'::jsonb),
    'academic_years', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.academic_years) x), '[]'::jsonb),
    'terms', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.terms) x), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.classes) x), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.sections) x), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.subjects) x), '[]'::jsonb),
    'teachers', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.teachers) x), '[]'::jsonb),
    'teacher_assignments', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.teacher_assignments) x), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.students) x), '[]'::jsonb),
    'enrollments', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.enrollments) x), '[]'::jsonb),
    'student_documents', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.student_documents) x), '[]'::jsonb),
    'assessment_structures', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.assessment_structures) x), '[]'::jsonb),
    'assessment_items', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.assessment_items) x), '[]'::jsonb),
    'assessment_marks', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.assessment_marks) x), '[]'::jsonb),
    'mark_submissions', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.mark_submissions) x), '[]'::jsonb),
    'grade_bands', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.grade_bands) x), '[]'::jsonb),
    'attendance_registers', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.attendance_registers) x), '[]'::jsonb),
    'attendance_entries', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.attendance_entries) x), '[]'::jsonb),
    'fee_items', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.fee_items) x), '[]'::jsonb),
    'homework', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.homework) x), '[]'::jsonb),
    'timetable_entries', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.timetable_entries) x), '[]'::jsonb),
    'role_defs', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.role_defs) x), '[]'::jsonb),
    'role_permissions', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.role_permissions) x), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.profiles) x), '[]'::jsonb),
    'guardian_students', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.guardian_students) x), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.announcements) x), '[]'::jsonb),
    'announcement_reads', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.announcement_reads) x), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.conversations) x), '[]'::jsonb),
    'conversation_participants', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.conversation_participants) x), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.messages) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.notifications) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.events) x), '[]'::jsonb),
    'audit_log', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.audit_log) x), '[]'::jsonb),
    'message_reports', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.message_reports) x), '[]'::jsonb)
  );
$$;

grant execute on function public.get_app_snapshot() to authenticated;
