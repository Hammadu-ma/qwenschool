import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, Baby, BookOpen, CalendarCheck2, ClipboardList, Clock, FileBarChart2, Inbox, Layers, Megaphone,
  PenLine as NotebookPen, Table2, Users, Wallet, GraduationCap, CheckCircle2, AlertCircle,
} from "lucide-react";
import { DAYS, PERIODS } from "../data/seed";
import {
  attendanceStats, childrenOf, fmtShort, getSubject, guardianOfStudent, sectionShort, shortName, studentAverage,
  studentOf, studentResults, teacherPairs, teacherStudentIds, teachersOfStudent, timeAgo, todayISO, useApp,
  visibleNotices,
} from "../store";
import { Avatar, Btn, Chip, Panel, Ring, RoleBadge, Stat } from "../ui";
import type { Student } from "../types";

const CAT_COLOR: Record<string, string> = { Urgent: "#c2503d", Academic: "#2c654c", Exams: "#3a6b8c", Event: "#e2a21d", General: "#5d6b62" };

function DayBanner({ title, kicker, chips, children }: { title: ReactNode; kicker: string; chips?: ReactNode; children?: ReactNode }) {
  const now = new Date();
  return (
    <div className="anim-rise relative overflow-hidden rounded-2xl bg-pine-900 px-4 py-5 text-pine-50 sm:px-7 sm:py-6">
      <div className="pointer-events-none absolute -right-8 -top-16 h-52 w-52 rounded-full border-[20px] border-pine-800/60" />
      <div className="pointer-events-none absolute -right-2 top-10 h-16 w-16 rounded-full border-[9px] border-gold-500/30" />
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-300">{kicker}</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[24px] font-extrabold leading-tight tracking-tight text-white sm:text-[32px]">{title}</h1>
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      </div>
      <p className="mt-1 text-[12px] text-pine-300">
        {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      </p>
      {children}
    </div>
  );
}

function NoticeDigest() {
  const { db, currentUser } = useApp();
  const nav = useNavigate();
  const notices = [...visibleNotices(db, currentUser)].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at.localeCompare(a.at)).slice(0, 3);
  return (
    <Panel className="anim-rise p-5" >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-pine-600" />
          <h2 className="font-display text-[15px] font-bold tracking-tight">Notice board</h2>
        </div>
        <Btn variant="ghost" size="sm" onClick={() => nav("/notices")}>View board <ArrowRight className="h-3.5 w-3.5" /></Btn>
      </div>
      <ul className="mt-3 space-y-2.5">
        {notices.map((n) => (
          <li key={n.id}>
            <button onClick={() => nav("/notices")} className="group flex w-full cursor-pointer items-start gap-2.5 text-left">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[n.category] }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold leading-snug text-ink transition-colors group-hover:text-pine-800">{n.title}</span>
                <span className="text-[10.5px] text-soft">{n.category}{n.pinned ? " · Pinned" : ""} · {timeAgo(n.at)}</span>
              </span>
            </button>
          </li>
        ))}
        {notices.length === 0 && <li className="text-[11.5px] text-soft">Nothing posted for your audience yet.</li>}
      </ul>
    </Panel>
  );
}

/* ================================ ADMIN ================================ */
export function AdminDashboard() {
  const { db, currentUser, yearId } = useApp();
  const nav = useNavigate();
  const enrolled = db.students.filter((s) => s.enrollment?.yearId === yearId);
  const sections = db.classes.reduce((s, c) => s + c.sections.length, 0);
  const structures = db.structures.filter((s) => s.yearId === yearId).length;
  const activeUsers = db.users.filter((u) => u.status === "active").length;
  const dow = (new Date().getDay() + 6) % 7;
  const todayLessons = db.timetable.filter((t) => t.day === dow).sort((a, b) => a.period - b.period);
  const takenToday = db.attendance.filter((r) => r.date === todayISO()).length;
  const openRegisters = sections - takenToday;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <DayBanner
        kicker={`${db.settings.schoolName} · front office`}
        title={<>Good day, {currentUser?.name.split(" ")[0]}</>}
        chips={<>
          <Chip className="!border-pine-700 !bg-pine-800 !text-gold-300 font-mono">AY {db.years.find((y) => y.id === yearId)?.name}</Chip>
          <RoleBadge role="admin" />
        </>}
      >
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat label="Enrolled students" value={enrolled.length} sub={`${sections} sections`} icon={<Users className="h-4.5 w-4.5" />} onClick={() => nav("/admin/students")} />
          <Stat label="Staff & accounts" value={db.users.length} sub={`${activeUsers} active`} icon={<GraduationCap className="h-4.5 w-4.5" />} tone="gold" onClick={() => nav("/admin/users")} />
          <Stat label="Assessment structures" value={structures} sub="mark entry ready" icon={<Table2 className="h-4.5 w-4.5" />} tone="steel" onClick={() => nav("/admin/marks")} />
          <Stat label="Registers open today" value={Math.max(0, openRegisters)} sub={openRegisters > 0 ? "need attention" : "all taken"} icon={<CalendarCheck2 className="h-4.5 w-4.5" />} tone={openRegisters > 0 ? "rust" : "pine"} onClick={() => nav("/admin/attendance")} />
        </div>
      </DayBanner>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">Today's lessons — schoolwide</h2>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => nav("/admin/timetable")}>Timetable <ArrowRight className="h-3.5 w-3.5" /></Btn>
            </div>
            <ul className="divide-y divide-mist/70">
              {todayLessons.slice(0, 6).map((t) => {
                const subj = getSubject(db, t.subjectId);
                return (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-pine-50/60">
                    <span className="tnum w-12 shrink-0 font-mono text-[12px] font-semibold text-soft">{PERIODS[t.period - 1].time}</span>
                    <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: subj?.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-ink">{subj?.name}</p>
                      <p className="text-[11.5px] text-soft">{sectionShort(db, t.classId, t.sectionId)} · Room {t.room}</p>
                    </div>
                    <Chip tone="gray">P{t.period}</Chip>
                  </li>
                );
              })}
              {todayLessons.length === 0 && <li className="px-5 py-8 text-center text-[12.5px] text-soft">No lessons scheduled today.</li>}
            </ul>
          </Panel>

          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">Recent admissions</h2>
              </div>
              <Btn variant="gold" size="sm" onClick={() => nav("/admin/students")}>Manage students <ArrowRight className="h-3.5 w-3.5" /></Btn>
            </div>
            <ul className="divide-y divide-mist/70">
              {[...enrolled].sort((a, b) => b.admission.date.localeCompare(a.admission.date)).slice(0, 5).map((s) => (
                <li key={s.id}>
                  <button onClick={() => nav(`/admin/students/${s.id}`)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-pine-50/60">
                    <Avatar student={s} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-ink">{shortName(s)}</p>
                      <p className="font-mono text-[11px] text-soft">{s.regId}</p>
                    </div>
                    <Chip tone="pine">{sectionShort(db, s.enrollment?.classId, s.enrollment?.sectionId)}</Chip>
                    <span className="hidden w-20 text-right text-[11.5px] text-soft sm:block">{fmtShort(s.admission.date)}</span>
                    <ArrowRight className="h-4 w-4 text-soft/50" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="anim-rise p-5">
            <h2 className="font-display text-[15px] font-bold tracking-tight">Quick actions</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                { label: "Register student", icon: <Users className="h-4 w-4" />, to: "/admin/students" },
                { label: "Enter marks", icon: <Table2 className="h-4 w-4" />, to: "/admin/marks" },
                { label: "Take register", icon: <CalendarCheck2 className="h-4 w-4" />, to: "/admin/attendance" },
                { label: "Manage users", icon: <GraduationCap className="h-4 w-4" />, to: "/admin/users" },
              ].map((a) => (
                <button key={a.label} onClick={() => nav(a.to)} className="flex cursor-pointer items-center gap-2 rounded-lg border border-mist bg-paper px-3 py-2.5 text-[12px] font-bold text-ink transition-all duration-150 hover:-translate-y-0.5 hover:border-pine-400 hover:bg-pine-50">
                  <span className="text-pine-600">{a.icon}</span> {a.label}
                </button>
              ))}
            </div>
          </Panel>
          <NoticeDigest />
        </div>
      </div>
    </div>
  );
}

/* ================================ TEACHER ================================ */
export function TeacherDashboard() {
  const { db, currentUser, yearId } = useApp();
  const nav = useNavigate();
  const pairs = teacherPairs(db, currentUser);
  const myStudents = teacherStudentIds(db, currentUser);
  const mySubjects = [...new Set(pairs.flatMap((p) => p.subjectIds))];
  const dow = (new Date().getDay() + 6) % 7;
  const myLessons = db.timetable.filter((t) => t.day === dow && pairs.some((p) => p.classId === t.classId && p.sectionId === t.sectionId));
  const myHomework = db.homework.filter((h) => pairs.some((p) => p.classId === h.classId && p.sectionId === h.sectionId) && h.subjectId && mySubjects.includes(h.subjectId));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <DayBanner
        kicker="Teacher workspace"
        title={<>Welcome, {currentUser?.name}</>}
        chips={<>
          <RoleBadge role="teacher" />
          <Chip className="!border-pine-700 !bg-pine-800 !text-pine-200">{mySubjects.map((s) => getSubject(db, s)?.code).join(" · ")}</Chip>
        </>}
      >
        <p className="mt-2 max-w-xl text-[12.5px] text-pine-200">
          Your access follows your subject assignments — {pairs.length} class sections and {myStudents.size} students are visible to you. Everything else is out of scope.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat label="My class sections" value={pairs.length} icon={<Layers className="h-4.5 w-4.5" />} onClick={() => nav("/teacher/classes")} />
          <Stat label="My students" value={myStudents.size} icon={<Users className="h-4.5 w-4.5" />} tone="gold" onClick={() => nav("/teacher/students")} />
          <Stat label="Lessons today" value={myLessons.length} icon={<Clock className="h-4.5 w-4.5" />} tone="steel" onClick={() => nav("/teacher/classes")} />
          <Stat label="Assignments set" value={myHomework.length} icon={<ClipboardList className="h-4.5 w-4.5" />} tone="pine" onClick={() => nav("/teacher/assignments")} />
        </div>
      </DayBanner>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">My lessons today</h2>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => nav("/teacher/classes")}>My classes <ArrowRight className="h-3.5 w-3.5" /></Btn>
            </div>
            <ul className="divide-y divide-mist/70">
              {myLessons.sort((a, b) => a.period - b.period).map((t) => {
                const subj = getSubject(db, t.subjectId);
                const mine = currentUser?.teacherId && db.assignments.some((a) => a.classId === t.classId && a.sectionId === t.sectionId && a.subjectId === t.subjectId && a.teacherId === currentUser.teacherId);
                return (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-pine-50/60">
                    <span className="tnum w-12 shrink-0 font-mono text-[12px] font-semibold text-soft">{PERIODS[t.period - 1].time}</span>
                    <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: subj?.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-ink">{subj?.name}</p>
                      <p className="text-[11.5px] text-soft">{sectionShort(db, t.classId, t.sectionId)} · Room {t.room}</p>
                    </div>
                    {mine ? <Chip tone="pine">You teach this</Chip> : <Chip tone="gray">Covering view</Chip>}
                  </li>
                );
              })}
              {myLessons.length === 0 && <li className="px-5 py-8 text-center text-[12.5px] text-soft">No lessons in your sections today.</li>}
            </ul>
          </Panel>

          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">My class sections</h2>
              </div>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {pairs.map((p) => {
                const count = db.students.filter((s) => s.enrollment?.classId === p.classId && s.enrollment?.sectionId === p.sectionId).length;
                return (
                  <button key={p.classId + p.sectionId} onClick={() => nav("/teacher/students")} className="group cursor-pointer rounded-lg border border-mist bg-paper/60 px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-pine-400 hover:bg-pine-50">
                    <p className="font-display text-[14px] font-extrabold text-ink">{sectionShort(db, p.classId, p.sectionId)}</p>
                    <p className="mt-0.5 text-[11px] text-soft">{count} students · {p.subjectIds.map((s) => getSubject(db, s)?.code).join(", ")}</p>
                    <div className="mt-2 flex gap-1">
                      {p.subjectIds.map((s) => <span key={s} className="h-1.5 w-6 rounded-full" style={{ background: getSubject(db, s)?.color }} />)}
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="anim-rise p-5">
            <h2 className="font-display text-[15px] font-bold tracking-tight">Teaching tools</h2>
            <div className="mt-3 space-y-2">
              {[
                { label: "Enter marks", sub: "assessment structures & grades", icon: <Table2 className="h-4 w-4" />, to: "/teacher/marks" },
                { label: "Take attendance", sub: "today's registers", icon: <CalendarCheck2 className="h-4 w-4" />, to: "/teacher/attendance" },
                { label: "Set assignment", sub: "publish to a section", icon: <ClipboardList className="h-4 w-4" />, to: "/teacher/assignments" },
              ].map((a) => (
                <button key={a.label} onClick={() => nav(a.to)} className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-mist bg-card px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-pine-400 hover:shadow-md">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pine-100 text-pine-700 transition-transform group-hover:scale-110">{a.icon}</span>
                  <span className="flex-1">
                    <span className="block text-[13px] font-bold text-ink">{a.label}</span>
                    <span className="text-[11px] text-soft">{a.sub}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-soft/40 transition-transform group-hover:translate-x-0.5 group-hover:text-pine-700" />
                </button>
              ))}
            </div>
          </Panel>
          <NoticeDigest />
        </div>
      </div>
    </div>
  );
}

/* ================================ STUDENT ================================ */
export function StudentDashboard() {
  const { db, currentUser } = useApp();
  const nav = useNavigate();
  const me = studentOf(db, currentUser);
  if (!me || !me.enrollment) {
    return (
      <Panel className="mx-auto max-w-xl"><div className="p-8 text-center text-[13px] text-soft">Your account isn't linked to a student record. Ask the front office to connect it.</div></Panel>
    );
  }
  const att = attendanceStats(db, me.id);
  const avg = studentAverage(db, me);
  const results = studentResults(db, me).filter((r) => r.calc.complete);
  const myTeachers = teachersOfStudent(db, me);
  const dow = (new Date().getDay() + 6) % 7;
  const myLessons = db.timetable.filter((t) => t.day === dow && t.classId === me.enrollment!.classId && t.sectionId === me.enrollment!.sectionId).sort((a, b) => a.period - b.period);
  const due = db.homework.filter((h) => h.classId === me.enrollment!.classId && h.sectionId === me.enrollment!.sectionId && !h.submitted.includes(me.id) && h.due >= todayISO());
  const guardian = guardianOfStudent(db, me.id);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <DayBanner
        kicker="Student workspace"
        title={<>Hi {me.firstName} — ready to learn?</>}
        chips={<>
          <RoleBadge role="student" />
          <Chip tone="gold">{sectionShort(db, me.enrollment.classId, me.enrollment.sectionId)}</Chip>
        </>}
      >
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat label="Attendance" value={`${att.pct}%`} sub={`${att.present}P · ${att.late}L · ${att.absent}A`} icon={<CalendarCheck2 className="h-4.5 w-4.5" />} onClick={() => nav("/student/attendance")} />
          <Stat label="Average grade" value={avg != null ? `${avg}%` : "—"} icon={<FileBarChart2 className="h-4.5 w-4.5" />} tone="gold" onClick={() => nav("/student/grades")} />
          <Stat label="Assignments due" value={due.length} sub={due.length ? "pending submission" : "all handed in"} icon={<NotebookPen className="h-4.5 w-4.5" />} tone={due.length ? "rust" : "pine"} onClick={() => nav("/student/assignments")} />
          <Stat label="My teachers" value={myTeachers.length} icon={<GraduationCap className="h-4.5 w-4.5" />} tone="steel" onClick={() => nav("/student/classes")} />
        </div>
      </DayBanner>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">My timetable today</h2>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => nav("/student/classes")}>My classes <ArrowRight className="h-3.5 w-3.5" /></Btn>
            </div>
            <ul className="divide-y divide-mist/70">
              {myLessons.map((t) => {
                const subj = getSubject(db, t.subjectId);
                const teacher = db.assignments.find((a) => a.classId === t.classId && a.sectionId === t.sectionId && a.subjectId === t.subjectId);
                return (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-pine-50/60">
                    <span className="tnum w-12 shrink-0 font-mono text-[12px] font-semibold text-soft">{PERIODS[t.period - 1].time}</span>
                    <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: subj?.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-ink">{subj?.name}</p>
                      <p className="text-[11.5px] text-soft">{db.teachers.find((x) => x.id === teacher?.teacherId)?.name ?? "—"} · Room {t.room}</p>
                    </div>
                  </li>
                );
              })}
              {myLessons.length === 0 && <li className="px-5 py-8 text-center text-[12.5px] text-soft">No lessons today — enjoy the day!</li>}
            </ul>
          </Panel>

          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FileBarChart2 className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">Latest results</h2>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => nav("/student/grades")}>All grades <ArrowRight className="h-3.5 w-3.5" /></Btn>
            </div>
            <ul className="divide-y divide-mist/70">
              {results.slice(0, 5).map(({ st, calc, subject }) => (
                <li key={st.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: subject?.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">{subject?.name} <span className="font-normal text-soft">· {st.period}</span></p>
                    <p className="text-[11px] text-soft">{calc.complete ? "Complete" : "In progress"}</p>
                  </div>
                  <span className="tnum font-mono text-[13px] font-bold text-pine-800">{calc.pct}%</span>
                </li>
              ))}
              {results.length === 0 && <li className="px-5 py-8 text-center text-[12.5px] text-soft">No published results yet this term.</li>}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="anim-rise p-5">
            <h2 className="font-display text-[15px] font-bold tracking-tight">My circle</h2>
            <div className="mt-3 space-y-2">
              {myTeachers.map(({ teacher, subjectIds }) => (
                <div key={teacher.id} className="flex items-center gap-2.5 rounded-lg border border-mist bg-paper/60 px-3 py-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pine-800 font-display text-[11px] font-bold text-white">{teacher.name.replace(/^(Mr\.|Ms\.|Mrs\.)\s*/, "").split(" ").map((w) => w[0]).join("")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-ink">{teacher.name}</p>
                    <p className="text-[10.5px] text-soft">{subjectIds.map((s) => getSubject(db, s)?.name).join(", ")}</p>
                  </div>
                </div>
              ))}
              {guardian && (
                <div className="flex items-center gap-2.5 rounded-lg border border-gold-200 bg-gold-100/50 px-3 py-2">
                  <Baby className="h-4 w-4 shrink-0 text-gold-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-ink">{guardian.name}</p>
                    <p className="text-[10.5px] text-soft">Linked guardian · {guardian.email}</p>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <NotebookPen className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">To hand in</h2>
              </div>
            </div>
            <ul className="divide-y divide-mist/70">
              {due.slice(0, 4).map((h) => (
                <li key={h.id} className="flex items-center gap-2.5 px-5 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: getSubject(db, h.subjectId)?.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-ink">{h.title}</p>
                    <p className="text-[10.5px] text-soft">{getSubject(db, h.subjectId)?.name} · due {fmtShort(h.due)}</p>
                  </div>
                </li>
              ))}
              {due.length === 0 && <li className="flex items-center gap-2 px-5 py-6 text-[12px] font-semibold text-pine-700"><CheckCircle2 className="h-4 w-4" /> Nothing pending — nice work.</li>}
            </ul>
          </Panel>
          <NoticeDigest />
        </div>
      </div>
    </div>
  );
}

/* ================================ GUARDIAN ================================ */
export function GuardianDashboard() {
  const { db, currentUser } = useApp();
  const nav = useNavigate();
  const kids = childrenOf(db, currentUser);
  const [childId, setChildId] = useState(kids[0]?.id ?? "");
  const child: Student | undefined = kids.find((k) => k.id === childId) ?? kids[0];

  if (!child || !child.enrollment) {
    return (
      <Panel className="mx-auto max-w-xl">
        <div className="p-8 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-gold-600" />
          <p className="mt-2 text-[13.5px] font-bold text-ink">No children linked yet</p>
          <p className="mt-1 text-[12.5px] text-soft">The front office connects guardian accounts to student records. Once linked, your children appear here instantly.</p>
        </div>
      </Panel>
    );
  }

  const att = attendanceStats(db, child.id);
  const avg = studentAverage(db, child);
  const fees = db.fees.filter((f) => f.studentId === child.id);
  const outstanding = fees.reduce((s, f) => s + (f.amount - f.paid), 0);
  const results = studentResults(db, child).filter((r) => r.calc.complete);
  const myTeachers = teachersOfStudent(db, child);
  const due = db.homework.filter((h) => h.classId === child.enrollment!.classId && h.sectionId === child.enrollment!.sectionId && !h.submitted.includes(child.id));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <DayBanner
        kicker="Family workspace"
        title={<>Welcome, {currentUser?.name}</>}
        chips={<>
          <RoleBadge role="guardian" />
          <Chip className="!border-pine-700 !bg-pine-800 !text-pine-200">{kids.length} registered child{kids.length === 1 ? "" : "ren"}</Chip>
        </>}
      >
        {/* child selector — everything below follows this choice */}
        <div className="mt-4 flex flex-wrap gap-2">
          {kids.map((k) => (
            <button
              key={k.id}
              onClick={() => setChildId(k.id)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition-all duration-150 ${
                child.id === k.id ? "border-gold-400 bg-pine-800 shadow-md" : "border-pine-700 bg-pine-800/50 hover:bg-pine-800"
              }`}
            >
              <Avatar student={k} size={30} className="ring-pine-700" />
              <span className="text-left">
                <span className="block text-[12.5px] font-bold leading-tight text-white">{shortName(k)}</span>
                <span className="text-[10.5px] text-pine-300">{sectionShort(db, k.enrollment?.classId, k.enrollment?.sectionId)}</span>
              </span>
              {child.id === k.id && <CheckCircle2 className="h-4 w-4 text-gold-400" />}
            </button>
          ))}
        </div>
      </DayBanner>

      <div className="anim-rise grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Class & section" value={child.enrollment ? sectionShort(db, child.enrollment.classId, child.enrollment.sectionId).split(" · ")[1] ?? "—" : "—"} sub={db.classes.find((c) => c.id === child.enrollment?.classId)?.name} icon={<BookOpen className="h-4.5 w-4.5" />} onClick={() => nav("/guardian/children")} />
        <Stat label="Attendance" value={`${att.pct}%`} sub={`${att.absent} absences`} icon={<CalendarCheck2 className="h-4.5 w-4.5" />} tone={att.pct >= 90 ? "pine" : "gold"} onClick={() => nav("/guardian/attendance")} />
        <Stat label="Average grade" value={avg != null ? `${avg}%` : "—"} icon={<FileBarChart2 className="h-4.5 w-4.5" />} tone="gold" onClick={() => nav("/guardian/grades")} />
        <Stat label="Fees outstanding" value={outstanding > 0 ? `ETB ${outstanding.toLocaleString()}` : "Clear"} icon={<Wallet className="h-4.5 w-4.5" />} tone={outstanding > 0 ? "rust" : "pine"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FileBarChart2 className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">{child.firstName}'s results</h2>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => nav("/guardian/grades")}>Full grades <ArrowRight className="h-3.5 w-3.5" /></Btn>
            </div>
            <ul className="divide-y divide-mist/70">
              {results.slice(0, 6).map(({ st, calc, subject }) => (
                <li key={st.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: subject?.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">{subject?.name}</p>
                    <p className="text-[11px] text-soft">{st.period} · weighted total</p>
                  </div>
                  <span className="tnum font-mono text-[13px] font-bold text-pine-800">{calc.pct}%</span>
                </li>
              ))}
              {results.length === 0 && <li className="px-5 py-8 text-center text-[12.5px] text-soft">No published results yet this term.</li>}
            </ul>
          </Panel>

          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">{child.firstName}'s teachers</h2>
              </div>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {myTeachers.map(({ teacher, subjectIds }) => (
                <div key={teacher.id} className="flex items-center gap-2.5 rounded-lg border border-mist bg-paper/60 px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pine-800 font-display text-[11px] font-bold text-white">{teacher.name.replace(/^(Mr\.|Ms\.|Mrs\.)\s*/, "").split(" ").map((w) => w[0]).join("")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-ink">{teacher.name}</p>
                    <p className="text-[10.5px] text-soft">{subjectIds.map((s) => getSubject(db, s)?.name).join(", ")}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="anim-rise overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist px-5 py-3.5">
              <div className="flex items-center gap-2">
                <NotebookPen className="h-4 w-4 text-pine-600" />
                <h2 className="font-display text-[15px] font-bold tracking-tight">Pending homework</h2>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => nav("/guardian/assignments")}>All <ArrowRight className="h-3.5 w-3.5" /></Btn>
            </div>
            <ul className="divide-y divide-mist/70">
              {due.slice(0, 4).map((h) => (
                <li key={h.id} className="flex items-center gap-2.5 px-5 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: getSubject(db, h.subjectId)?.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-ink">{h.title}</p>
                    <p className="text-[10.5px] text-soft">{getSubject(db, h.subjectId)?.name} · due {fmtShort(h.due)}</p>
                  </div>
                </li>
              ))}
              {due.length === 0 && <li className="flex items-center gap-2 px-5 py-6 text-[12px] font-semibold text-pine-700"><CheckCircle2 className="h-4 w-4" /> All handed in.</li>}
            </ul>
          </Panel>
          <NoticeDigest />
        </div>
      </div>
    </div>
  );
}
