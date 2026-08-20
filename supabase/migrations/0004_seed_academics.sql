-- ===========================================================================
-- Riverside SMS — 0004_seed_academics.sql
-- Timetable, homework, assessment structures + items, marks (generated with
-- the same deterministic function as the app), workflow submissions, grading,
-- attendance, fees, announcements, conversations, notifications, events, audit.
-- Idempotent.
-- ===========================================================================

/* ---------------- timetable (generated) ---------------- */
do $$
declare
  d integer; p integer;
  subj text[] := array['math','bio','eng','phy','hist'];
  fills text[][] := array[['c8','sec8b','0'],['c8','sec8b','1'],['c8','sec8b','2'],['c8','sec8b','3'],['c8','sec8b','4'],
                          ['c8','sec8a','0'],['c8','sec8a','2'],['c8','sec8a','4'],
                          ['c7','sec7a','1'],['c7','sec7a','3']];
  f text[]; off integer;
begin
  foreach f slice 1 in array fills loop
    off := case when f[1] = 'c8' then 0 else 1 end;
    for p in 0..5 loop
      insert into public.timetable_entries (id, class_id, section_id, day, period, subject_id, room)
      values ('tt-' || f[1] || '-' || f[2] || '-' || f[3] || '-' || (p+1),
              f[1], f[2], f[3]::int, p + 1,
              subj[((f[3]::int * 3 + p * 2 + off) % 5) + 1],
              'R-20' || ((f[3]::int + p + case when f[1]='c8' then 1 else 4 end) % 10))
      on conflict (id) do nothing;
    end loop;
  end loop;
end $$;

/* ---------------- homework ---------------- */
insert into public.homework (id, year_id, class_id, section_id, subject_id, title, description, issued, due, submitted_students) values
 ('hw1','y26','c8','sec8b','math','Exercises 1–10, page 24','Solve exercises 1–10 from the textbook. Show all working steps.',
   (current_date - 3), (current_date + 2), array['st1','st2','st3','st5']),
 ('hw2','y26','c8','sec8b','bio','Lab report — onion cell slide','One-page lab report with a labelled diagram.',
   (current_date - 2), (current_date + 4), array['st1','st6']),
 ('hw3','y26','c8','sec8b','eng','Essay: My favourite season','300 words, five adjectives, two similes.',
   (current_date - 6), (current_date - 1), array['st1','st2','st4','st7','st9']),
 ('hw4','y26','c8','sec8a','phy','Speed & velocity — sheet 3','Problems 1–8 with SI units.',
   (current_date - 1), (current_date + 6), '{}'),
 ('hw5','y26','c7','sec7a','math','Fractions worksheet','Complete the worksheet handed out in class.',
   (current_date - 2), (current_date + 3), array['st18'])
on conflict (id) do nothing;

/* ---------------- assessment structures + items ---------------- */
insert into public.assessment_structures (id, year_id, class_id, subject_id, term_id) values
 ('as-bio8s1','y26','c8','bio','y26-t1'),
 ('as-math8s1','y26','c8','math','y26-t1'),
 ('as-eng8s1','y26','c8','eng','y26-t1'),
 ('as-phy8s1','y26','c8','phy','y26-t1'),
 ('as-hist8s1','y26','c8','hist','y26-t1')
on conflict (id) do nothing;

insert into public.assessment_items (id, structure_id, name, max_mark, weight, sort) values
 ('bio8s1-i1','as-bio8s1','Assessment 1',20,20,1), ('bio8s1-i2','as-bio8s1','Assessment 2',20,20,2),
 ('bio8s1-i3','as-bio8s1','Assessment 3',20,20,3), ('bio8s1-i4','as-bio8s1','Final Exam',40,40,4),
 ('math8s1-i1','as-math8s1','Quiz 1',10,10,1), ('math8s1-i2','as-math8s1','Assignment',10,10,2),
 ('math8s1-i3','as-math8s1','Midterm',30,30,3), ('math8s1-i4','as-math8s1','Final Exam',50,50,4),
 ('eng8s1-i1','as-eng8s1','Listening',20,20,1), ('eng8s1-i2','as-eng8s1','Assignment',10,10,2),
 ('eng8s1-i3','as-eng8s1','Midterm',30,30,3), ('eng8s1-i4','as-eng8s1','Final Exam',40,40,4),
 ('phy8s1-i1','as-phy8s1','Practical',30,30,1), ('phy8s1-i2','as-phy8s1','Midterm',30,30,2),
 ('phy8s1-i3','as-phy8s1','Final Exam',40,40,3),
 ('hist8s1-i1','as-hist8s1','Quiz 1',10,10,1), ('hist8s1-i2','as-hist8s1','Assignment',10,10,2),
 ('hist8s1-i3','as-hist8s1','Midterm',30,30,3), ('hist8s1-i4','as-hist8s1','Final Exam',50,50,4)
on conflict (id) do nothing;

/* ---------------- marks (same deterministic generator as the app) ---------------- */
do $$
declare
  ability numeric[] := array[0.87,0.93,0.80,0.84,0.76,0.90,0.71,0.79,0.86,
                             0.82,0.88,0.74,0.91,0.69,0.85,0.78,0.89];
  struct record; item record;
  sid text; idx integer; jitter numeric; raw integer; floor_min integer;
begin
  for struct in select * from public.assessment_structures where class_id = 'c8' loop
    for idx in 1..17 loop
      sid := 'st' || idx;
      -- Biology skips st9 (a student mid-entry in the demo narrative)
      if struct.id = 'as-bio8s1' and idx = 9 then continue; end if;
      for item in select * from public.assessment_items where structure_id = struct.id order by sort loop
        jitter := (public.seed_rnd(idx, (struct.id || item.id)::text % 1000 ) - 0.5) * 0.18;
        -- match the app: salt per structure+item ordinal
        floor_min := round(item.max_mark * 0.3)::int;
        raw := least(item.max_mark::int, greatest(floor_min, round(item.max_mark * (ability[idx] + jitter))::int));
        insert into public.assessment_marks (id, structure_id, item_id, student_id, raw_mark, entered_by)
        values (struct.id || ':' || sid || ':' || item.id, struct.id, item.id, sid, raw,
                '7d0a0000-0000-4000-8000-000000000004')
        on conflict (item_id, student_id) do nothing;
      end loop;
    end loop;
  end loop;

  -- Pinned example rows (the documented Abebe / Hana / Ahmed Biology numbers).
  update public.assessment_marks set raw_mark = v.m
  from (values ('bio8s1-i1','st1',18),('bio8s1-i2','st1',17),('bio8s1-i3','st1',19),('bio8s1-i4','st1',35),
               ('bio8s1-i1','st2',16),('bio8s1-i2','st2',18),('bio8s1-i3','st2',17),('bio8s1-i4','st2',32),
               ('bio8s1-i1','st3',12),('bio8s1-i2','st3',14),('bio8s1-i3','st3',13),('bio8s1-i4','st3',25)
       ) as v(item, sid, m)
  where assessment_marks.item_id = v.item and assessment_marks.student_id = v.sid;

  -- One student mid-entry: Bereket has no Final Exam mark yet.
  delete from public.assessment_marks where item_id = 'bio8s1-i4' and student_id = 'st7';
end $$;

/* ---------------- workflow demo states ---------------- */
insert into public.mark_submissions
  (id, structure_id, status, submitted_by, submitted_at, approved_by, approved_at, published_by, published_at, returned_by, returned_at, return_reason)
values
 ('sub-bio8','as-bio8s1','published','7d0a0000-0000-4000-8000-000000000004', now() - interval '6 days',
   '7d0a0000-0000-4000-8000-000000000002', now() - interval '5 days',
   '7d0a0000-0000-4000-8000-000000000002', now() - interval '4 days', null, null, null),
 ('sub-math8','as-math8s1','approved','7d0a0000-0000-4000-8000-000000000004', now() - interval '3 days',
   '7d0a0000-0000-4000-8000-000000000002', now() - interval '2 days', null, null, null, null, null),
 ('sub-eng8','as-eng8s1','submitted','7d0a0000-0000-4000-8000-000000000005', now() - interval '1 day',
   null, null, null, null, null, null, null),
 ('sub-phy8','as-phy8s1','returned','7d0a0000-0000-4000-8000-000000000005', now() - interval '2 days',
   null, null, null, null, '7d0a0000-0000-4000-8000-000000000002', now() - interval '1 day',
   'Please verify Practical marks for Section B — two entries exceed the component maximum.')
on conflict (structure_id) do nothing;

/* ---------------- grading scale ---------------- */
insert into public.grade_bands (id, school_id, min_pct, max_pct, grade, remark, sort) values
 ('gb1','school-1',90,100,'A+','Outstanding',1),
 ('gb2','school-1',80,89.99,'A','Excellent',2),
 ('gb3','school-1',70,79.99,'B','Very good',3),
 ('gb4','school-1',60,69.99,'C','Good',4),
 ('gb5','school-1',50,59.99,'D','Fair',5),
 ('gb6','school-1',0,49.99,'F','Needs improvement',6)
on conflict (id) do nothing;

/* ---------------- attendance (past 12 weekdays + today; 8A/8B open today) ---------------- */
do $$
declare
  day date; di integer := 0;
  days date[];
  sec record; ci integer;
  stu record; si integer;
  r numeric; reg text; st text;
begin
  select array_agg(d order by d desc) into days
  from (select generate_series(current_date - 20, current_date - 1, interval '1 day')::date as d) t
  where extract(dow from d) not in (0, 6)
  limit 12;
  days := days || current_date;

  for di in 1..array_length(days, 1) loop
    day := days[di];
    ci := 0;
    for sec in select * from (values ('c7','sec7a'),('c8','sec8a'),('c8','sec8b')) as t(c, s) loop
      ci := ci + 1;
      if day = current_date and sec.c = 'c8' then continue; end if;
      reg := 'att-' || day || '-' || sec.s;
      insert into public.attendance_registers (id, day, class_id, section_id, recorded_by)
      values (reg, day, sec.c, sec.s, '7d0a0000-0000-4000-8000-000000000002')
      on conflict (day, class_id, section_id) do nothing;
      si := 0;
      for stu in
        select e.student_id from public.enrollments e
        where e.year_id = 'y26' and e.class_id = sec.c and e.section_id = sec.s and e.status = 'active'
        order by e.student_id
      loop
        si := si + 1;
        r := public.seed_rnd((di - 1) * 31 + (si - 1) * 7 + (ci - 1) * 13, 53);
        st := case when r < 0.055 then 'absent' when r < 0.1 then 'late' else 'present' end;
        insert into public.attendance_entries (id, register_id, student_id, status)
        values (reg || '-' || stu.student_id, reg, stu.student_id, st)
        on conflict (register_id, student_id) do nothing;
      end loop;
    end loop;
  end loop;
end $$;

/* ---------------- fees ---------------- */
do $$
declare n integer;
begin
  for n in 1..23 loop
    insert into public.fee_items (id, student_id, label, amount, paid, due_date) values
      ('fe' || (n*2-1), 'st' || n, 'Tuition — Term 1', 4500, case when (n-1) % 4 = 0 then 2500 else 4500 end, current_date - 20),
      ('fe' || (n*2),   'st' || n, 'Laboratory & materials', 350, case when (n-1) % 3 = 0 then 0 else 350 end, current_date + 12)
    on conflict (id) do nothing;
  end loop;
end $$;

/* ---------------- announcements + reads ---------------- */
insert into public.announcements
  (id, title, body, category, sender_id, audience, status, scheduled_for, published_at, pinned, created_at) values
 ('an1','Water supply interruption — Friday 09:00–12:00',
   E'Municipality maintenance on our line. Water off in blocks B and C Friday morning.\n\nCanteen serves a cold menu; practicals move to block A. Refill bottles before 09:00.',
   'Urgent','7d0a0000-0000-4000-8000-000000000002','{"kind":"everyone"}','published',null,now() - interval '3 hours',true,now() - interval '3 hours'),
 ('an2','First Semester Midterm timetable released',
   E'The midterm schedule is live. Check your grade''s dates and duration per subject.\n\nArrive 15 minutes early with your student ID card.',
   'Exams','7d0a0000-0000-4000-8000-000000000002','{"kind":"everyone"}','published',null,now() - interval '2 days',true,now() - interval '2 days'),
 ('an3','PTA General Meeting — Saturday 9:00 AM',
   'All guardians invited to the main hall. Agenda: fee adjustment, examination calendar and the results workflow.',
   'Event','7d0a0000-0000-4000-8000-000000000002','{"kind":"guardians"}','published',null,now() - interval '3 days',false,now() - interval '3 days'),
 ('an4','Midterm revision pack — Grade 8B families',
   'The revision pack covers units 1–4. Please ensure students finish the timed practice sheet before Friday.',
   'Academic','7d0a0000-0000-4000-8000-000000000004','{"kind":"section-guardians","classId":"c8","sectionId":"sec8b"}','published',null,now() - interval '2 days',false,now() - interval '2 days'),
 ('an5','Sports Day — house registrations close Wednesday',
   'Registrations for athletics, football and relay close next Wednesday. Sign up with your PE teacher or class monitor.',
   'Event','7d0a0000-0000-4000-8000-000000000002','{"kind":"students"}','scheduled',now() + interval '1 day',null,false,now() - interval '1 day'),
 ('an6','Staff meeting — Thursday 3:30 PM',
   'Agenda: midterm moderation, sports day duties, assessment structures. Please confirm attendance.',
   'General','7d0a0000-0000-4000-8000-000000000002','{"kind":"teachers"}','draft',null,null,false,now() - interval '5 hours')
on conflict (id) do nothing;

insert into public.announcement_reads (announcement_id, profile_id) values
 ('an1','7d0a0000-0000-4000-8000-000000000002'), ('an1','7d0a0000-0000-4000-8000-000000000004'), ('an1','7d0a0000-0000-4000-8000-000000000007'),
 ('an2','7d0a0000-0000-4000-8000-000000000002'), ('an2','7d0a0000-0000-4000-8000-000000000004'), ('an2','7d0a0000-0000-4000-8000-000000000005'),
 ('an2','7d0a0000-0000-4000-8000-000000000007'), ('an2','7d0a0000-0000-4000-8000-000000000009'),
 ('an3','7d0a0000-0000-4000-8000-000000000002'), ('an3','7d0a0000-0000-4000-8000-000000000009'),
 ('an4','7d0a0000-0000-4000-8000-000000000004'), ('an4','7d0a0000-0000-4000-8000-000000000009'),
 ('an5','7d0a0000-0000-4000-8000-000000000002'), ('an6','7d0a0000-0000-4000-8000-000000000002')
on conflict do nothing;

/* ---------------- conversations / participants / messages ---------------- */
insert into public.conversations (id, related_student_id, related_class_id, related_section_id, related_subject_id, status, created_at, updated_at) values
 ('cv1','st1','c8','sec8b','bio','active', now() - interval '3 days', now() - interval '3 hours'),
 ('cv2','st1','c8','sec8b','bio','active', now() - interval '2 days', now() - interval '1 day'),
 ('cv3','st2','c8','sec8b','eng','active', now() - interval '4 days', now() - interval '2 days'),
 ('cv4','st3',null,null,null,'active', now() - interval '5 days', now() - interval '3 days'),
 ('cv5',null,null,null,null,'active', now() - interval '6 days', now() - interval '4 days')
on conflict (id) do nothing;

insert into public.conversation_participants (conversation_id, profile_id) values
 ('cv1','7d0a0000-0000-4000-8000-000000000004'), ('cv1','7d0a0000-0000-4000-8000-000000000009'),
 ('cv2','7d0a0000-0000-4000-8000-000000000004'), ('cv2','7d0a0000-0000-4000-8000-000000000007'),
 ('cv3','7d0a0000-0000-4000-8000-000000000005'), ('cv3','7d0a0000-0000-4000-8000-000000000009'),
 ('cv4','7d0a0000-0000-4000-8000-00000000000a'), ('cv4','7d0a0000-0000-4000-8000-000000000002'),
 ('cv5','7d0a0000-0000-4000-8000-000000000007'), ('cv5','7d0a0000-0000-4000-8000-000000000002')
on conflict do nothing;

insert into public.messages (conversation_id, sender_id, body, read_by, created_at) values
 ('cv1','7d0a0000-0000-4000-8000-000000000004','Good morning. Abebe has been doing very well in Biology this term — I wanted to share that his lab work is excellent.',
   array['7d0a0000-0000-4000-8000-000000000004'::uuid,'7d0a0000-0000-4000-8000-000000000009'::uuid], now() - interval '3 days'),
 ('cv1','7d0a0000-0000-4000-8000-000000000009','Thank you Mr. Ahmed, that''s wonderful to hear. We''ll keep encouraging him at home.',
   array['7d0a0000-0000-4000-8000-000000000004'::uuid,'7d0a0000-0000-4000-8000-000000000009'::uuid], now() - interval '3 days' + interval '10 minutes'),
 ('cv1','7d0a0000-0000-4000-8000-000000000004','One reminder: the midterm revision pack is due Friday. Please make sure Abebe completes the timed practice sheet.',
   array['7d0a0000-0000-4000-8000-000000000004'::uuid], now() - interval '3 hours'),
 ('cv2','7d0a0000-0000-4000-8000-000000000007','Sir, I had a question about question 4 on the genetics worksheet.',
   array['7d0a0000-0000-4000-8000-000000000004'::uuid,'7d0a0000-0000-4000-8000-000000000007'::uuid], now() - interval '2 days'),
 ('cv2','7d0a0000-0000-4000-8000-000000000004','Of course — remember the Punnett square we did in class. Try setting it up for both parents first, then combine.',
   array['7d0a0000-0000-4000-8000-000000000004'::uuid,'7d0a0000-0000-4000-8000-000000000007'::uuid], now() - interval '2 days' + interval '50 minutes'),
 ('cv3','7d0a0000-0000-4000-8000-000000000005','Hello. Hana''s reading comprehension has improved a lot this month. Keep up the great support at home!',
   array['7d0a0000-0000-4000-8000-000000000005'::uuid,'7d0a0000-0000-4000-8000-000000000009'::uuid], now() - interval '4 days'),
 ('cv4','7d0a0000-0000-4000-8000-00000000000a','Hello, I''d like to ask about the laboratory fee for this term.',
   array['7d0a0000-0000-4000-8000-000000000002'::uuid,'7d0a0000-0000-4000-8000-00000000000a'::uuid], now() - interval '5 days'),
 ('cv4','7d0a0000-0000-4000-8000-000000000002','Of course. The laboratory & materials fee is ETB 350, due with Term 1 tuition. I can email you the breakdown.',
   array['7d0a0000-0000-4000-8000-000000000002'::uuid], now() - interval '3 days'),
 ('cv5','7d0a0000-0000-4000-8000-000000000007','Good morning. When will the midterm timetable be posted?',
   array['7d0a0000-0000-4000-8000-000000000002'::uuid,'7d0a0000-0000-4000-8000-000000000007'::uuid], now() - interval '6 days')
on conflict do nothing;

/* ---------------- notifications ---------------- */
insert into public.notifications (profile_id, type, title, body, is_read, created_at) values
 ('7d0a0000-0000-4000-8000-000000000007','announcement','First Semester Midterm timetable released','Check your grade''s dates and duration per subject.',true,now() - interval '2 days'),
 ('7d0a0000-0000-4000-8000-000000000007','homework','New Biology homework posted','Genetics worksheet — due Friday.',false,now() - interval '1 day'),
 ('7d0a0000-0000-4000-8000-000000000009','message','Mr. Ahmed Yusuf sent you a message','One reminder: the midterm revision pack is due Friday…',false,now() - interval '3 hours'),
 ('7d0a0000-0000-4000-8000-000000000009','announcement','PTA General Meeting — Saturday 9:00 AM','All guardians invited to the main hall.',false,now() - interval '3 days'),
 ('7d0a0000-0000-4000-8000-000000000004','system','Midterm mark entry opens Monday','Assessment structures are ready for your subjects.',false,now() - interval '1 day'),
 ('7d0a0000-0000-4000-8000-00000000000a','message','School Administrator replied','The laboratory & materials fee is ETB 350…',false,now() - interval '3 days')
on conflict do nothing;

/* ---------------- events ---------------- */
insert into public.events (id, title, description, day, time_of_day, location, category, audience, created_by) values
 ('ev1','First Semester Midterm Examinations','Midterm examinations for all grades.',current_date + 12,'08:30','All blocks','Exams','{"kind":"everyone"}','7d0a0000-0000-4000-8000-000000000002'),
 ('ev2','PTA General Meeting',null,current_date + 4,'09:00','Main hall','Event','{"kind":"guardians"}','7d0a0000-0000-4000-8000-000000000002'),
 ('ev3','Annual Sports Day',null,current_date + 20,'08:00','School field','Event','{"kind":"students"}','7d0a0000-0000-4000-8000-000000000002'),
 ('ev4','Staff moderation workshop',null,current_date + 7,'15:30','Staff room','Academic','{"kind":"teachers"}','7d0a0000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

/* ---------------- audit trail ---------------- */
insert into public.audit_log (actor_id, actor_name, action, target, detail, at) values
 ('7d0a0000-0000-4000-8000-000000000001','Dr. Selam Bekele','role.create','Academic Coordinator','Custom role with academic + results permissions.',now() - interval '10 days'),
 ('7d0a0000-0000-4000-8000-000000000002','Amara Tesfaye','announcement.publish','First Semester Midterm timetable released','Entire school',now() - interval '2 days'),
 ('7d0a0000-0000-4000-8000-000000000002','Amara Tesfaye','user.deactivate','Mr. Ali Omar','Account disabled — on leave.',now() - interval '9 days'),
 ('7d0a0000-0000-4000-8000-000000000004','Mr. Ahmed Yusuf','conversation.open','Kebede Tesema','About Abebe Kebede · Biology',now() - interval '3 days'),
 ('7d0a0000-0000-4000-8000-000000000002','Amara Tesfaye','marks.approve','Biology — Grade 8 · Semester 1','Approved after moderation.',now() - interval '5 days'),
 ('7d0a0000-0000-4000-8000-000000000002','Amara Tesfaye','marks.return','Physics — Grade 8 · Semester 1','Two entries exceed the component maximum.',now() - interval '1 day')
on conflict do nothing;
