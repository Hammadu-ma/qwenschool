import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BadgeCheck, Baby, BookOpen, CalendarCheck2, CreditCard, FileBarChart2, History, Inbox, KeyRound, Layers, Lock,
  FileText as Notebook, Pencil, Plus, Search, ShieldCheck, Trash2, User as UserIcon, Users, Wallet, Eye, GraduationCap, X,
} from "lucide-react";
import type { Enrollment, Role, Student, User, UserStatus } from "../types";
import {
  assessmentCalc, attendanceStats, canSeeStudent, childrenOf, feeStats, fmtDate, fullName, getClass, getSection,
  getSubject, gradeFor, guardianOfStudent, homePathFor, ordinal, sectionLabel, sectionShort, shortName,
  studentAverage, studentOf, studentResults, structureRanks, teacherPairs, teacherStudentIds, teachersOfStudent,
  todayISO, uid, useApp,
} from "../store";
import {
  Avatar, Btn, Chip, EmptyState, Field, Modal, PageHead, Panel, Ring, RoleBadge, Select, Tabs, TextInput,
  UserAvatar, tdCls, thCls,
} from "../ui";
import { AccessDenied } from "./Auth";
import { defaultRoleIdFor, hasPermission, pushAudit } from "../rbac";
import { IDCardModal, RegistrationWizard } from "./registration";

/* ================= students directory (role-scoped) ================= */
export function StudentsPage({ scoped }: { scoped?: boolean }) {
  const { db, currentUser, yearId, update, toast } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [sec, setSec] = useState("");
  const [regOpen, setRegOpen] = useState(false);

  const isAdmin = currentUser?.role === "admin";
  const role = currentUser?.role ?? "admin";

  // Authorization underneath the UI: the visible set is derived from relationships.
  const allowedIds: Set<string> | null = useMemo(() => {
    if (role === "admin") return null; // null = everything
    if (role === "teacher") return teacherStudentIds(db, currentUser);
    if (role === "guardian") return new Set((currentUser?.childrenIds ?? []));
    return new Set<string>();
  }, [db, currentUser, role]);

  const base = db.students.filter((s) => s.enrollment && s.enrollment.yearId === yearId);
  const rows = base
    .filter((s) => allowedIds === null || allowedIds.has(s.id))
    .filter((s) => (!cls || s.enrollment!.classId === cls) && (!sec || s.enrollment!.sectionId === sec))
    .filter((s) => (q ? fullName(s).toLowerCase().includes(q.toLowerCase()) || s.regId.toLowerCase().includes(q.toLowerCase()) : true))
    .sort((a, b) => a.regId.localeCompare(b.regId));

  const profilePath = (id: string) =>
    role === "admin" ? `/admin/students/${id}` : role === "teacher" ? `/teacher/students/${id}` : `/guardian/children/${id}`;

  const head = scoped
    ? role === "teacher"
      ? { kicker: "Teaching", title: "My students", sub: `Only students in your ${teacherPairs(db, currentUser).length} assigned class sections appear here — the rest of the school is out of scope.` }
      : { kicker: "Family", title: "My children", sub: "Your registered children, exactly as linked by the front office." }
    : { kicker: "People", title: "Students", sub: `${base.length} enrolled in AY ${db.years.find((y) => y.id === yearId)?.name}. One record per student — reused by attendance, marks, fees and reports.` };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead {...head}>
        {isAdmin && (
          <Btn variant="gold" onClick={() => setRegOpen(true)}><Plus className="h-4 w-4" /> Register student</Btn>
        )}
      </PageHead>

      <Panel className="anim-rise overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-mist px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or student ID…" className="!pl-9" />
          </div>
          <Select value={cls} onChange={(e) => { setCls(e.target.value); setSec(""); }} className="!w-40">
            <option value="">All grades</option>
            {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={sec} onChange={(e) => setSec(e.target.value)} className="!w-36" disabled={!cls}>
            <option value="">All sections</option>
            {getClass(db, cls)?.sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
          </Select>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No students match" body={scoped ? "No students are linked to your account yet." : "Adjust the filters or register a new student."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="border-b border-mist bg-paper/60">
                <tr>
                  <th className={thCls()}>Student</th>
                  <th className={thCls()}>Placement</th>
                  <th className={`${thCls()} hidden md:table-cell`}>Guardian</th>
                  <th className={`${thCls()} hidden sm:table-cell`}>Admitted</th>
                  <th className={thCls()}>Attendance</th>
                  <th className={thCls()}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist/70">
                {rows.map((s) => {
                  const att = attendanceStats(db, s.id);
                  const g = guardianOfStudent(db, s.id);
                  return (
                    <tr key={s.id} onClick={() => nav(profilePath(s.id))} className="cursor-pointer transition-colors hover:bg-pine-50/70">
                      <td className={tdCls()}>
                        <span className="flex items-center gap-3">
                          <Avatar student={s} size={34} />
                          <span>
                            <span className="block font-bold text-ink">{fullName(s)}</span>
                            <span className="font-mono text-[11px] text-soft">{s.regId}</span>
                          </span>
                        </span>
                      </td>
                      <td className={tdCls()}><Chip tone="pine">{sectionShort(db, s.enrollment!.classId, s.enrollment!.sectionId)}</Chip></td>
                      <td className={`${tdCls()} hidden text-soft md:table-cell`}>{g ? g.name : s.guardian.father}</td>
                      <td className={`${tdCls()} hidden text-soft sm:table-cell`}>{fmtDate(s.admission.date)}</td>
                      <td className={tdCls()}>
                        <span className="flex items-center gap-2">
                          <Ring pct={att.pct} size={34} stroke={4} label={`${Math.round(att.pct)}`} color={att.pct >= 90 ? "var(--color-pine-600)" : att.pct >= 75 ? "var(--color-gold-500)" : "var(--color-rust-500)"} />
                        </span>
                      </td>
                      <td className={`${tdCls()} text-right`}>
                        <Chip tone="gray">View <Eye className="h-3 w-3" /></Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {regOpen && <RegistrationWizard onClose={() => setRegOpen(false)} onSaved={(id) => nav(`/admin/students/${id}`)} />}
    </div>
  );
}

/* ================= register student (admin) ================= */
function RegisterStudentModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { db, yearId, update, toast } = useApp();
  const [f, setF] = useState({
    firstName: "", middleName: "", lastName: "", gender: "Male" as "Male" | "Female", dob: "", address: "",
    gFather: "", gPhone: "", classId: "c8", sectionId: "", admDate: todayISO(), prevSchool: "",
    makeLogin: true, username: "", password: "stud123",
  });
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const save = () => {
    if (!f.firstName.trim() || !f.lastName.trim() || !f.dob || !f.sectionId) {
      toast("First name, last name, date of birth and section are required.", "warn");
      return;
    }
    if (f.makeLogin && (!f.username.trim() || !f.password.trim())) {
      toast("Login needs a username and password (or untick “Create login”).", "warn");
      return;
    }
    if (f.makeLogin && db.users.some((u) => u.username.toLowerCase() === f.username.trim().toLowerCase())) {
      toast("That username is already taken.", "warn");
      return;
    }
    const id = uid();
    const regNo = `ST-2026-${String(db.students.length + 1).padStart(3, "0")}`;
    update((d) => {
      d.students.push({
        id, regId: regNo,
        firstName: f.firstName.trim(), middleName: f.middleName.trim(), lastName: f.lastName.trim(),
        gender: f.gender, dob: f.dob, address: f.address.trim(),
        guardian: { father: f.gFather.trim() || "—", relation: "Father", phone: f.gPhone.trim(), address: f.address.trim() },
        admission: { number: `ADM-2026-${String(d.students.length + 1).padStart(3, "0")}`, date: f.admDate, previousSchool: f.prevSchool.trim(), type: "New Admission" },
        enrollment: { yearId, classId: f.classId, sectionId: f.sectionId, status: "active", enrolledOn: f.admDate },
        history: [{ yearId, classId: f.classId, sectionId: f.sectionId, status: "active", enrolledOn: f.admDate }],
        documents: [],
        status: "active",
      });
      if (f.makeLogin) {
        d.users.push({
          id: uid(), name: `${f.firstName.trim()} ${f.lastName.trim()}`, username: f.username.trim(), password: f.password.trim(),
          role: "student", roleId: "student", status: "active", studentId: id, createdAt: todayISO(),
        });
      }
    });
    toast(`${f.firstName.trim()} ${f.lastName.trim()} registered${f.makeLogin ? " — student login created" : ""}.`);
    onSaved(id);
  };
  return (
    <Modal title="Register student" kicker="One record, reused everywhere" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}><Plus className="h-4 w-4" /> Save student</Btn></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="First name" required><TextInput value={f.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
        <Field label="Middle name"><TextInput value={f.middleName} onChange={(e) => set("middleName", e.target.value)} /></Field>
        <Field label="Last name" required><TextInput value={f.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
        <Field label="Gender" required>
          <Select value={f.gender} onChange={(e) => set("gender", e.target.value)}><option>Male</option><option>Female</option></Select>
        </Field>
        <Field label="Date of birth" required><TextInput type="date" value={f.dob} onChange={(e) => set("dob", e.target.value)} /></Field>
        <Field label="Admission date" required><TextInput type="date" value={f.admDate} onChange={(e) => set("admDate", e.target.value)} /></Field>
        <Field label="Guardian name"><TextInput value={f.gFather} onChange={(e) => set("gFather", e.target.value)} /></Field>
        <Field label="Guardian phone"><TextInput value={f.gPhone} onChange={(e) => set("gPhone", e.target.value)} /></Field>
        <Field label="Previous school"><TextInput value={f.prevSchool} onChange={(e) => set("prevSchool", e.target.value)} /></Field>
        <Field label="Grade" required>
          <Select value={f.classId} onChange={(e) => setF((p) => ({ ...p, classId: e.target.value, sectionId: "" }))}>
            {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Section" required>
          <Select value={f.sectionId} onChange={(e) => set("sectionId", e.target.value)}>
            <option value="">Select…</option>
            {getClass(db, f.classId)?.sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Address"><TextInput value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
      </div>
      <div className="mt-4 rounded-lg border border-pine-200 bg-pine-50 p-3.5">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={f.makeLogin} onChange={(e) => set("makeLogin", e.target.checked)} className="h-4 w-4 accent-pine-700" />
          <span className="text-[12.5px] font-bold text-pine-900">Create a student login</span>
          <span className="text-[11px] text-pine-700">— they sign in and see only their own records</span>
        </label>
        {f.makeLogin && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Username" required><TextInput value={f.username} onChange={(e) => set("username", e.target.value)} placeholder="e.g. abebe.k" className="font-mono" /></Field>
            <Field label="Temporary password" required><TextInput value={f.password} onChange={(e) => set("password", e.target.value)} className="font-mono" /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ================= student profile (entity-guarded) ================= */
export function StudentProfilePage() {
  const { db, currentUser } = useApp();
  const { id } = useParams();
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [idCardOpen, setIdCardOpen] = useState(false);

  const s = db.students.find((x) => x.id === id);
  if (!s) return <AccessDenied required="A valid student id" reason="No student record matches that address." />;

  // ENTITY-LEVEL authorization: role alone isn't enough — the relationship must hold.
  if (!canSeeStudent(db, currentUser, s.id)) {
    const why =
      currentUser?.role === "teacher"
        ? "This student isn't in any class section you teach. Teacher access follows your subject assignments."
        : currentUser?.role === "guardian"
          ? "This student isn't registered under your guardian account. Guardians can only open their own children."
          : currentUser?.role === "student"
            ? "Students can only open their own record."
            : "You need to sign in to view this record.";
    return <AccessDenied required="A relationship to this student" reason={why} />;
  }

  const isAdmin = currentUser?.role === "admin";
  const isGuardian = currentUser?.role === "guardian";
  const enr = s.enrollment;
  const att = attendanceStats(db, s.id);
  const avg = studentAverage(db, s);
  const results = studentResults(db, s);
  const fees = feeStats(db, s.id);
  const teachers = teachersOfStudent(db, s);
  const homework = db.homework.filter((h) => h.classId === enr?.classId && h.sectionId === enr?.sectionId);

  return (
    <div className="mx-auto max-w-6xl">
      <Panel className="anim-rise overflow-hidden">
        <div className="relative bg-pine-900 px-4 py-4 sm:px-6 sm:py-5">
          <div className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full border-[18px] border-pine-800/70" />
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <Avatar student={s} size={56} className="ring-4 ring-pine-700" />
            <div className="min-w-0">
              <h1 className="font-display text-[21px] font-extrabold leading-tight tracking-tight text-white sm:text-[25px]">{fullName(s)}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Chip className="!border-pine-700 !bg-pine-800 font-mono !text-gold-300">{s.regId}</Chip>
                {enr && <Chip tone="gold">{sectionLabel(db, enr.classId, enr.sectionId)}</Chip>}
                <Chip className="!border-pine-700 !bg-pine-800 !text-pine-200">{s.gender}</Chip>
                {!isAdmin && <Chip className="!border-pine-700 !bg-pine-800 !text-pine-200"><Lock className="h-3 w-3" /> Read-only for {currentUser?.role}</Chip>}
              </div>
            </div>
            <div className="ml-auto flex gap-2">
              {(isAdmin || isGuardian) && (
                <Btn variant="soft" size="sm" onClick={() => setIdCardOpen(true)}><CreditCard className="h-3.5 w-3.5" /> ID card</Btn>
              )}
              {isAdmin && (
                <Btn variant="gold" size="sm" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Btn>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-mist sm:grid-cols-4">
          {[
            { label: "Attendance", node: <Ring pct={att.pct} size={42} stroke={5} color={att.pct >= 90 ? "var(--color-pine-600)" : "var(--color-gold-500)"} /> },
            { label: "Average", node: <span className="font-display text-[20px] font-extrabold text-pine-800 sm:text-[24px]">{avg != null ? `${avg}%` : "—"}</span> },
            { label: "Grade", node: <span className="font-display text-[20px] font-extrabold text-ink sm:text-[24px]">{avg != null ? gradeFor(avg, db.grading).grade : "—"}</span> },
            { label: "Guardian", node: <span className="text-[13px] font-bold text-ink">{guardianOfStudent(db, s.id)?.name ?? s.guardian.father}</span> },
          ].map((x) => (
            <div key={x.label} className="bg-card px-3.5 py-3 sm:px-4">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-soft">{x.label}</p>
              {x.node}
            </div>
          ))}
        </div>
      </Panel>

      <div className="anim-rise mt-4">
        <Tabs
          tabs={[
            { id: "overview", label: "Overview", icon: <UserIcon className="h-3.5 w-3.5" /> },
            { id: "grades", label: "Grades", icon: <FileBarChart2 className="h-3.5 w-3.5" /> },
            { id: "attendance", label: "Attendance", icon: <CalendarCheck2 className="h-3.5 w-3.5" /> },
            { id: "assignments", label: "Assignments", icon: <Notebook className="h-3.5 w-3.5" /> },
            ...(isAdmin || isGuardian ? [{ id: "fees", label: "Fees", icon: <Wallet className="h-3.5 w-3.5" /> }] : []),
            { id: "documents", label: "Documents", icon: <Inbox className="h-3.5 w-3.5" /> },
            { id: "history", label: "History", icon: <History className="h-3.5 w-3.5" /> },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      <div className="mt-4 space-y-4">
        {tab === "overview" && (
          <div className="anim-rise grid gap-4 md:grid-cols-3">
            <Panel className="p-5">
              <h3 className="mb-3 font-display text-[14px] font-bold">Personal</h3>
              <dl className="space-y-2.5 text-[13px]">
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Date of birth</dt><dd className="font-semibold text-ink">{fmtDate(s.dob)}</dd></div>
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Address</dt><dd className="font-semibold text-ink">{s.address || "—"}</dd></div>
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Student email</dt><dd className="font-semibold text-ink">{s.email || "—"}</dd></div>
              </dl>
            </Panel>
            <Panel className="p-5">
              <h3 className="mb-3 font-display text-[14px] font-bold">Family</h3>
              <dl className="space-y-2.5 text-[13px]">
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Guardian ({s.guardian.relation})</dt><dd className="font-semibold text-ink">{s.guardian.father}</dd></div>
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Mother</dt><dd className="font-semibold text-ink">{s.guardian.mother || "—"}</dd></div>
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Phone</dt><dd className="font-semibold text-ink">{s.guardian.phone || "—"}</dd></div>
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Linked account</dt><dd>{guardianOfStudent(db, s.id) ? <Chip tone="gold"><Baby className="h-3 w-3" /> {guardianOfStudent(db, s.id)!.username}</Chip> : <Chip tone="gray">none</Chip>}</dd></div>
              </dl>
            </Panel>
            <Panel className="p-5">
              <h3 className="mb-3 font-display text-[14px] font-bold">Placement & teachers</h3>
              <dl className="space-y-2.5 text-[13px]">
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Class</dt><dd className="font-semibold text-ink">{enr ? sectionLabel(db, enr.classId, enr.sectionId) : "—"}</dd></div>
                <div><dt className="text-[10.5px] font-bold uppercase tracking-wider text-soft">Admitted</dt><dd className="font-semibold text-ink">{fmtDate(s.admission.date)} · {s.admission.type}</dd></div>
                <div>
                  <dt className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-soft">Teachers</dt>
                  <dd className="flex flex-wrap gap-1">{teachers.map(({ teacher, subjectIds }) => <Chip key={teacher.id} tone="pine">{teacher.name} · {subjectIds.map((x) => getSubject(db, x)?.code).join("/")}</Chip>)}</dd>
                </div>
              </dl>
            </Panel>
          </div>
        )}

        {tab === "grades" && (
          <Panel className="anim-rise overflow-hidden">
            <div className="border-b border-mist px-5 py-3.5">
              <h3 className="font-display text-[15px] font-bold">Assessment results</h3>
              <p className="text-[11.5px] text-soft">Totals and percentages are weighted from each subject's assessment structure.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead className="border-b border-mist bg-paper/60">
                  <tr><th className={thCls()}>Subject</th><th className={thCls()}>Period</th><th className={thCls()}>Structure</th><th className={thCls()}>%</th><th className={thCls()}>Grade</th><th className={thCls()}>Position</th></tr>
                </thead>
                <tbody className="divide-y divide-mist/70">
                  {results.map(({ st, calc, subject }) => {
                    const ranks = structureRanks(db, st);
                    const band = gradeFor(calc.pct, db.grading);
                    return (
                      <tr key={st.id} className="transition-colors hover:bg-pine-50/50">
                        <td className={tdCls()}><span className="flex items-center gap-2 font-bold text-ink"><span className="h-4 w-1 rounded-full" style={{ background: subject?.color }} />{subject?.name}</span></td>
                        <td className={`${tdCls()} text-soft`}>{st.period}</td>
                        <td className={`${tdCls()} text-[11.5px] text-soft`}>{st.items.map((i) => i.name).join(" · ")}</td>
                        <td className={`${tdCls()} font-mono text-[12.5px] font-bold ${calc.complete ? "text-pine-800" : "text-gold-600"}`}>{calc.complete ? `${calc.pct}%` : "in progress"}</td>
                        <td className={tdCls()}>{calc.complete ? <Chip tone={calc.pct >= 80 ? "pine" : calc.pct >= 50 ? "gold" : "rust"}>{band.grade}</Chip> : "—"}</td>
                        <td className={`${tdCls()} text-soft`}>{calc.complete && ranks[s.id] ? `${ordinal(ranks[s.id])} of ${Object.keys(ranks).length}` : "—"}</td>
                      </tr>
                    );
                  })}
                  {results.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-[12.5px] text-soft">No assessment structures for this class yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {tab === "attendance" && (
          <div className="anim-rise grid gap-4 md:grid-cols-3">
            <Panel className="flex flex-col items-center justify-center gap-2 p-6">
              <Ring pct={att.pct} size={110} stroke={9} color={att.pct >= 90 ? "var(--color-pine-600)" : att.pct >= 75 ? "var(--color-gold-500)" : "var(--color-rust-500)"} />
              <p className="font-display text-[15px] font-bold">Overall attendance</p>
              <div className="mt-1 flex gap-2">
                <Chip tone="pine">{att.present} present</Chip>
                <Chip tone="gold">{att.late} late</Chip>
                <Chip tone="rust">{att.absent} absent</Chip>
              </div>
            </Panel>
            <Panel className="overflow-hidden md:col-span-2">
              <div className="border-b border-mist px-5 py-3.5"><h3 className="font-display text-[15px] font-bold">Register history</h3></div>
              <ul className="max-h-[360px] divide-y divide-mist/70 overflow-y-auto">
                {db.attendance
                  .filter((r) => r.classId === enr?.classId && r.sectionId === enr?.sectionId && r.marks[s.id])
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((r) => (
                    <li key={r.date} className="flex items-center justify-between px-5 py-2.5">
                      <span className="text-[13px] font-semibold text-ink">{fmtDate(r.date)}</span>
                      <Chip tone={r.marks[s.id] === "present" ? "pine" : r.marks[s.id] === "late" ? "gold" : "rust"}>{r.marks[s.id]}</Chip>
                    </li>
                  ))}
                {db.attendance.filter((r) => r.marks[s.id]).length === 0 && <li className="px-5 py-10 text-center text-[12.5px] text-soft">No registers recorded yet.</li>}
              </ul>
            </Panel>
          </div>
        )}

        {tab === "assignments" && (
          <Panel className="anim-rise overflow-hidden">
            <ul className="divide-y divide-mist/70">
              {homework.map((h) => {
                const done = h.submitted.includes(s.id);
                return (
                  <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: getSubject(db, h.subjectId)?.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold text-ink">{h.title}</p>
                      <p className="text-[11.5px] text-soft">{getSubject(db, h.subjectId)?.name} · issued {fmtDate(h.issued)} · due {fmtDate(h.due)}</p>
                    </div>
                    <Chip tone={done ? "pine" : h.due < todayISO() ? "rust" : "gold"}>{done ? "Submitted" : h.due < todayISO() ? "Overdue" : "Pending"}</Chip>
                  </li>
                );
              })}
              {homework.length === 0 && <li className="px-5 py-10 text-center text-[12.5px] text-soft">No assignments for this class yet.</li>}
            </ul>
          </Panel>
        )}

        {tab === "fees" && (
          <Panel className="anim-rise overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mist px-4 py-3.5 sm:px-5">
              <h3 className="font-display text-[15px] font-bold">Fee ledger</h3>
              <div className="flex flex-wrap gap-2">
                <Chip tone="gray">Billed ETB {fees.billed.toLocaleString()}</Chip>
                <Chip tone="pine">Paid ETB {fees.paid.toLocaleString()}</Chip>
                <Chip tone={fees.outstanding > 0 ? "rust" : "pine"}>Due ETB {fees.outstanding.toLocaleString()}</Chip>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px]">
                <thead className="border-b border-mist bg-paper/60"><tr><th className={thCls()}>Item</th><th className={thCls()}>Amount</th><th className={thCls()}>Paid</th><th className={thCls()}>Due</th><th className={thCls()}>Status</th></tr></thead>
                <tbody className="divide-y divide-mist/70">
                  {fees.items.map((f) => (
                    <tr key={f.id}>
                      <td className={`${tdCls()} font-bold text-ink`}>{f.label}</td>
                      <td className={`${tdCls()} font-mono text-[12px]`}>ETB {f.amount.toLocaleString()}</td>
                      <td className={`${tdCls()} font-mono text-[12px]`}>ETB {f.paid.toLocaleString()}</td>
                      <td className={`${tdCls()} text-soft`}>{fmtDate(f.due)}</td>
                      <td className={tdCls()}>{f.amount - f.paid > 0 ? <Chip tone="rust">ETB {(f.amount - f.paid).toLocaleString()} due</Chip> : <Chip tone="pine">Settled</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {tab === "documents" && (
          <Panel className="anim-rise overflow-hidden">
            <ul className="divide-y divide-mist/70">
              {s.documents.map((dc) => (
                <li key={dc.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pine-100 text-pine-700"><Notebook className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink">{dc.name}</p>
                    <p className="text-[11px] text-soft">{dc.kind} · {dc.size} · {fmtDate(dc.date)}</p>
                  </div>
                  <Chip tone="gray">{dc.kind}</Chip>
                </li>
              ))}
              {s.documents.length === 0 && <li className="px-5 py-10 text-center text-[12.5px] text-soft">No documents on file.</li>}
            </ul>
          </Panel>
        )}

        {tab === "history" && (
          <Panel className="anim-rise p-6">
            <h3 className="mb-1 font-display text-[15px] font-bold">Academic history</h3>
            <p className="mb-5 text-[12px] text-soft">Placements are appended each year — the record is never overwritten.</p>
            <ol className="relative ml-3 space-y-5 border-l-2 border-pine-200 pl-6">
              {[...s.history].sort((a, b) => a.yearId.localeCompare(b.yearId)).map((h, i, arr) => {
                const yr = db.years.find((y) => y.id === h.yearId);
                const current = i === arr.length - 1;
                return (
                  <li key={h.yearId + i} className="relative">
                    <span className={`absolute -left-[31px] top-1 h-4 w-4 rounded-full border-4 ${current ? "border-gold-300 bg-gold-500" : "border-pine-200 bg-pine-600"}`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-bold text-pine-700">{yr?.name}</span>
                      <span className="font-display text-[15px] font-bold text-ink">{sectionLabel(db, h.classId, h.sectionId)}</span>
                      {current && <Chip tone="gold">Current year</Chip>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
        )}
      </div>

      {editOpen && isAdmin && <RegistrationWizard student={s} onClose={() => setEditOpen(false)} />}
      {idCardOpen && <IDCardModal student={s} onClose={() => setIdCardOpen(false)} />}
    </div>
  );
}

function EditStudentModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const { update, toast, db } = useApp();
  const [f, setF] = useState({
    firstName: student.firstName, middleName: student.middleName, lastName: student.lastName,
    phone: student.phone ?? "", address: student.address ?? "",
    classId: student.enrollment?.classId ?? "", sectionId: student.enrollment?.sectionId ?? "",
    gFather: student.guardian.father, gPhone: student.guardian.phone ?? "",
  });
  const save = () => {
    if (!f.firstName.trim() || !f.lastName.trim() || !f.classId || !f.sectionId) { toast("Names and placement are required.", "warn"); return; }
    update((d) => {
      const st = d.students.find((x) => x.id === student.id)!;
      st.firstName = f.firstName.trim(); st.middleName = f.middleName.trim(); st.lastName = f.lastName.trim();
      st.phone = f.phone.trim(); st.address = f.address.trim();
      st.guardian.father = f.gFather.trim(); st.guardian.phone = f.gPhone.trim();
      const prev = st.enrollment;
      if (prev && (prev.classId !== f.classId || prev.sectionId !== f.sectionId)) {
        // rewrite the current year's history entry; earlier years stay untouched
        const next: Enrollment = { yearId: prev.yearId, classId: f.classId, sectionId: f.sectionId, status: "active", enrolledOn: prev.enrolledOn };
        st.enrollment = next;
        st.history[st.history.length - 1] = next;
      }
    });
    toast("Student record updated.");
    onClose();
  };
  return (
    <Modal title={`Edit ${shortName(student)}`} kicker="Admin only" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}>Save changes</Btn></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required><TextInput value={f.firstName} onChange={(e) => setF((p) => ({ ...p, firstName: e.target.value }))} /></Field>
        <Field label="Middle name"><TextInput value={f.middleName} onChange={(e) => setF((p) => ({ ...p, middleName: e.target.value }))} /></Field>
        <Field label="Last name" required><TextInput value={f.lastName} onChange={(e) => setF((p) => ({ ...p, lastName: e.target.value }))} /></Field>
        <Field label="Phone"><TextInput value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} /></Field>
        <Field label="Grade" required>
          <Select value={f.classId} onChange={(e) => setF((p) => ({ ...p, classId: e.target.value, sectionId: "" }))}>
            {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Section" required>
          <Select value={f.sectionId} onChange={(e) => setF((p) => ({ ...p, sectionId: e.target.value }))}>
            {getClass(db, f.classId)?.sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Guardian name"><TextInput value={f.gFather} onChange={(e) => setF((p) => ({ ...p, gFather: e.target.value }))} /></Field>
        <Field label="Guardian phone"><TextInput value={f.gPhone} onChange={(e) => setF((p) => ({ ...p, gPhone: e.target.value }))} /></Field>
      </div>
      <p className="mt-3 text-[11px] text-soft">Changing placement rewrites this year's history entry only — earlier years remain intact.</p>
    </Modal>
  );
}

/* ================= teachers + central assignment board (admin) ================= */
export function TeachersPage() {
  const { db, yearId, update, toast } = useApp();
  const [editT, setEditT] = useState<{ id?: string; name: string; specialty: string; phone: string; email: string } | null>(null);
  const [asg, setAsg] = useState({ classId: "c8", sectionId: "sec8b", subjectId: "math", teacherId: "t1" });

  const classesInSection = getClass(db, asg.classId)?.sections ?? [];

  const saveTeacher = () => {
    if (!editT || !editT.name.trim()) { toast("Teacher name is required.", "warn"); return; }
    update((d) => {
      if (editT.id) {
        const t = d.teachers.find((x) => x.id === editT.id)!;
        t.name = editT.name.trim(); t.specialty = editT.specialty.trim(); t.phone = editT.phone.trim(); t.email = editT.email.trim();
      } else {
        d.teachers.push({ id: uid(), name: editT.name.trim(), specialty: editT.specialty.trim(), phone: editT.phone.trim(), email: editT.email.trim() });
      }
    });
    toast(editT.id ? "Teacher updated." : "Teacher added — assign them subjects below.");
    setEditT(null);
  };

  const removeTeacher = (id: string) => {
    if (db.assignments.some((a) => a.teacherId === id)) { toast("Reassign their subjects first — this teacher still holds assignments.", "warn"); return; }
    update((d) => {
      d.teachers = d.teachers.filter((t) => t.id !== id);
      const u = d.users.find((x) => x.teacherId === id);
      if (u) u.status = "disabled";
    });
    toast("Teacher removed.");
  };

  const setAssignment = () => {
    update((d) => {
      const existing = d.assignments.find((a) => a.yearId === yearId && a.classId === asg.classId && a.sectionId === asg.sectionId && a.subjectId === asg.subjectId);
      if (existing) existing.teacherId = asg.teacherId;
      else d.assignments.push({ id: uid(), yearId, ...asg });
    });
    toast("Assignment saved — timetables, marks access and communication follow it automatically.");
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="People" title="Teachers" sub="Staff records plus the central subject-assignment board — the single relationship that powers marks access, timetables and communication.">
        <Btn variant="gold" onClick={() => setEditT({ name: "", specialty: "", phone: "", email: "" })}><Plus className="h-4 w-4" /> Add teacher</Btn>
      </PageHead>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="anim-rise overflow-hidden">
          <div className="border-b border-mist px-5 py-3.5"><h2 className="font-display text-[15px] font-bold">Staff roster</h2></div>
          <ul className="divide-y divide-mist/70">
            {db.teachers.map((t) => {
              const load = db.assignments.filter((a) => a.yearId === yearId && a.teacherId === t.id);
              const account = db.users.find((u) => u.teacherId === t.id);
              return (
                <li key={t.id} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-pine-50/50">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pine-800 font-display text-[12px] font-bold text-white">
                    {t.name.replace(/^(Mr\.|Ms\.|Mrs\.)\s*/, "").split(" ").map((w) => w[0]).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13.5px] font-bold text-ink">{t.name}
                      {account ? <Chip tone={account.status === "active" ? "pine" : "rust"}>{account.status === "active" ? "login active" : "login disabled"}</Chip> : <Chip tone="gray">no login</Chip>}
                    </p>
                    <p className="text-[11.5px] text-soft">{t.specialty || "—"} · {load.length} sections · {t.email}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => setEditT({ id: t.id, name: t.name, specialty: t.specialty ?? "", phone: t.phone ?? "", email: t.email ?? "" })} className="cursor-pointer rounded p-1.5 text-soft hover:bg-pine-100 hover:text-pine-700"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => removeTeacher(t.id)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="anim-rise overflow-hidden">
          <div className="border-b border-mist px-5 py-3.5">
            <h2 className="font-display text-[15px] font-bold">Teacher–subject assignments</h2>
            <p className="text-[11.5px] text-soft">AY {db.years.find((y) => y.id === yearId)?.name} · Grade → Section → Subject → Teacher</p>
          </div>
          <div className="grid grid-cols-2 gap-3 p-5">
            <Field label="Grade">
              <Select value={asg.classId} onChange={(e) => setAsg((p) => ({ ...p, classId: e.target.value, sectionId: db.classes.find((c) => c.id === e.target.value)?.sections[0]?.id ?? "" }))}>
                {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Section">
              <Select value={asg.sectionId} onChange={(e) => setAsg((p) => ({ ...p, sectionId: e.target.value }))}>
                {classesInSection.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
              </Select>
            </Field>
            <Field label="Subject">
              <Select value={asg.subjectId} onChange={(e) => setAsg((p) => ({ ...p, subjectId: e.target.value }))}>
                {db.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Teacher">
              <Select value={asg.teacherId} onChange={(e) => setAsg((p) => ({ ...p, teacherId: e.target.value }))}>
                {db.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="px-5 pb-4"><Btn onClick={setAssignment}><BadgeCheck className="h-4 w-4" /> Save assignment</Btn></div>
          <div className="max-h-[300px] overflow-y-auto border-t border-mist">
            <ul className="divide-y divide-mist/70">
              {db.assignments.filter((a) => a.yearId === yearId).map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-5 py-2 text-[12px]">
                  <span className="h-4 w-1 rounded-full" style={{ background: getSubject(db, a.subjectId)?.color }} />
                  <span className="font-bold text-ink">{sectionShort(db, a.classId, a.sectionId)}</span>
                  <span className="text-soft">· {getSubject(db, a.subjectId)?.name}</span>
                  <span className="ml-auto font-semibold text-pine-800">{db.teachers.find((t) => t.id === a.teacherId)?.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      {editT && (
        <Modal title={editT.id ? "Edit teacher" : "Add teacher"} kicker="People" onClose={() => setEditT(null)}
          footer={<><Btn variant="ghost" onClick={() => setEditT(null)}>Cancel</Btn><Btn onClick={saveTeacher}>Save</Btn></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2"><TextInput value={editT.name} onChange={(e) => setEditT({ ...editT, name: e.target.value })} placeholder="Mr. …" /></Field>
            <Field label="Specialty"><TextInput value={editT.specialty} onChange={(e) => setEditT({ ...editT, specialty: e.target.value })} /></Field>
            <Field label="Phone"><TextInput value={editT.phone} onChange={(e) => setEditT({ ...editT, phone: e.target.value })} /></Field>
            <Field label="Email" className="sm:col-span-2"><TextInput value={editT.email} onChange={(e) => setEditT({ ...editT, email: e.target.value })} /></Field>
          </div>
          <p className="mt-3 text-[11px] text-soft">Give them a login on the Users & roles page — their access will follow the assignment board above.</p>
        </Modal>
      )}
    </div>
  );
}

/* ================= families (admin) ================= */
export function FamiliesPage() {
  const { db, update, toast } = useApp();
  const [edit, setEdit] = useState<{ id?: string; name: string; username: string; password: string; phone: string; email: string; childrenIds: string[] } | null>(null);
  const guardians = db.users.filter((u) => u.role === "guardian");
  const enrolled = db.students.filter((s) => s.enrollment);

  const toggleChild = (id: string) =>
    setEdit((p) => p && { ...p, childrenIds: p.childrenIds.includes(id) ? p.childrenIds.filter((x) => x !== id) : [...p.childrenIds, id] });

  const save = () => {
    if (!edit || !edit.name.trim() || !edit.username.trim() || !edit.password.trim()) { toast("Name, username and password are required.", "warn"); return; }
    if (db.users.some((u) => u.username.toLowerCase() === edit.username.trim().toLowerCase() && u.id !== edit.id)) { toast("Username already taken.", "warn"); return; }
    update((d) => {
      if (edit.id) {
        const u = d.users.find((x) => x.id === edit.id)!;
        u.name = edit.name.trim(); u.username = edit.username.trim(); u.password = edit.password.trim();
        u.phone = edit.phone.trim(); u.email = edit.email.trim(); u.childrenIds = edit.childrenIds;
      } else {
        d.users.push({ id: uid(), name: edit.name.trim(), username: edit.username.trim(), password: edit.password.trim(), role: "guardian", roleId: "guardian", status: "active", phone: edit.phone.trim(), email: edit.email.trim(), childrenIds: edit.childrenIds, createdAt: todayISO() });
      }
    });
    toast(edit.id ? "Guardian updated." : "Guardian account created.");
    setEdit(null);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="People" title="Families" sub="Guardian accounts and the children connected to them. A guardian sees exactly these children — nothing more.">
        <Btn variant="gold" onClick={() => setEdit({ name: "", username: "", password: "fam123", phone: "", email: "", childrenIds: [] })}><Plus className="h-4 w-4" /> Add guardian</Btn>
      </PageHead>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {guardians.map((g, i) => {
          const kids = childrenOf(db, g);
          return (
            <Panel key={g.id} className="anim-rise group overflow-hidden">
              <div className="flex items-center gap-3 border-b border-mist px-5 py-4">
                <UserAvatar name={g.name} role="guardian" size={42} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-ink">{g.name}</p>
                  <p className="font-mono text-[11px] text-soft">@{g.username} · {g.status}</p>
                </div>
                <button onClick={() => setEdit({ id: g.id, name: g.name, username: g.username, password: g.password, phone: g.phone ?? "", email: g.email ?? "", childrenIds: g.childrenIds ?? [] })}
                  className="cursor-pointer rounded p-1.5 text-soft opacity-0 transition-all hover:bg-pine-100 hover:text-pine-700 group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-2 p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-soft">{kids.length} registered child{kids.length === 1 ? "" : "ren"}</p>
                {kids.map((k) => (
                  <div key={k.id} className="flex items-center gap-2.5 rounded-lg border border-mist bg-paper/60 px-3 py-2">
                    <Avatar student={k} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-bold text-ink">{shortName(k)}</p>
                      <p className="text-[10.5px] text-soft">{sectionShort(db, k.enrollment?.classId, k.enrollment?.sectionId)}</p>
                    </div>
                  </div>
                ))}
                {kids.length === 0 && <p className="rounded-lg bg-gold-100/60 px-3 py-2 text-[11.5px] font-semibold text-gold-700">No children linked yet.</p>}
              </div>
            </Panel>
          );
        })}
        {guardians.length === 0 && <Panel className="md:col-span-2 xl:col-span-3"><EmptyState icon={<Baby className="h-5 w-5" />} title="No guardian accounts" body="Create a guardian account and connect one or more children." /></Panel>}
      </div>

      {edit && (
        <Modal title={edit.id ? "Edit guardian" : "New guardian"} kicker="Families" onClose={() => setEdit(null)} wide
          footer={<><Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn><Btn onClick={save}><Baby className="h-4 w-4" /> Save guardian</Btn></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required><TextInput value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Phone"><TextInput value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Username" required><TextInput value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} className="font-mono" /></Field>
            <Field label="Password" required><TextInput value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} className="font-mono" /></Field>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Connected children — {edit.childrenIds.length} selected</p>
            <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-lg border border-mist p-2 sm:grid-cols-2">
              {enrolled.map((s) => {
                const on = edit.childrenIds.includes(s.id);
                return (
                  <button key={s.id} onClick={() => toggleChild(s.id)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all ${on ? "border-gold-400 bg-gold-100/60" : "border-mist bg-card hover:border-pine-300"}`}>
                    <Avatar student={s} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold text-ink">{shortName(s)}</span>
                      <span className="text-[10px] text-soft">{sectionShort(db, s.enrollment?.classId, s.enrollment?.sectionId)}</span>
                    </span>
                    {on && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-gold-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= user management (admin, req 16) ================= */
export function UsersPage() {
  const { db, currentUser, update, toast } = useApp();
  const [edit, setEdit] = useState<User | "new" | null>(null);

  const blank: User = { id: "", name: "", username: "", password: "", role: "student", roleId: "student", status: "active", createdAt: todayISO() };
  const draft = edit === "new" ? blank : edit;

  const set = (patch: Partial<User>) => setEdit((p) => (p && p !== "new" ? { ...p, ...patch } : p === "new" ? { ...blank, ...patch } : p));

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.username.trim() || !draft.password.trim()) { toast("Name, username and password are required.", "warn"); return; }
    if (db.users.some((u) => u.username.toLowerCase() === draft.username.trim().toLowerCase() && u.id !== draft.id)) { toast("Username already taken.", "warn"); return; }
    update((d) => {
      if (draft.id) {
        const u = d.users.find((x) => x.id === draft.id)!;
        Object.assign(u, { ...draft, name: draft.name.trim(), username: draft.username.trim() });
      } else {
        d.users.push({ ...draft, id: uid(), name: draft.name.trim(), username: draft.username.trim() });
      }
    });
    toast(draft.id ? "User updated." : `User created with role “${draft.role}”.`);
    setEdit(null);
  };

  const toggleStatus = (u: User) => {
    if (u.id === currentUser?.id) { toast("You can't disable your own account.", "warn"); return; }
    update((d) => {
      const x = d.users.find((y) => y.id === u.id)!;
      x.status = x.status === "active" ? "disabled" : "active";
    });
    toast(u.status === "active" ? `${u.name} disabled — their next request is rejected.` : `${u.name} re-activated.`);
  };

  const removeUser = (u: User) => {
    if (u.id === currentUser?.id) { toast("You can't delete your own account.", "warn"); return; }
    if (u.role === "admin" && db.users.filter((x) => x.role === "admin" && x.status === "active").length <= 1) {
      toast("The school needs at least one active administrator.", "warn"); return;
    }
    update((d) => { d.users = d.users.filter((x) => x.id !== u.id); });
    toast("User deleted.");
  };

  const relLabel = (u: User) => {
    if (u.role === "teacher") {
      const t = db.teachers.find((x) => x.id === u.teacherId);
      return t ? `Staff: ${t.name}` : "No staff record linked";
    }
    if (u.role === "student") {
      const s = db.students.find((x) => x.id === u.studentId);
      return s ? `Record: ${shortName(s)} · ${sectionShort(db, s.enrollment?.classId, s.enrollment?.sectionId)}` : "No student record linked";
    }
    if (u.role === "guardian") return `${(u.childrenIds ?? []).length} child(ren) linked`;
    return "Manages the whole school";
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Administration" title="Users & roles" sub="One authentication system, four roles. Links to staff, student and guardian records drive each account's access.">
        <Btn variant="gold" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> New user</Btn>
      </PageHead>

      <Panel className="anim-rise overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-mist bg-paper/60">
              <tr><th className={thCls()}>User</th><th className={thCls()}>Role</th><th className={`${thCls()} hidden md:table-cell`}>Relationship</th><th className={thCls()}>Status</th><th className={thCls()}></th></tr>
            </thead>
            <tbody className="divide-y divide-mist/70">
              {db.users.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-pine-50/50">
                  <td className={tdCls()}>
                    <span className="flex items-center gap-3">
                      <UserAvatar name={u.name} role={u.role} size={34} />
                      <span>
                        <span className="block font-bold text-ink">{u.name}{u.id === currentUser?.id && <span className="ml-1.5 text-[10.5px] font-semibold text-gold-600">(you)</span>}</span>
                        <span className="font-mono text-[11px] text-soft">@{u.username}</span>
                      </span>
                    </span>
                  </td>
                  <td className={tdCls()}><RoleBadge role={u.role} full /></td>
                  <td className={`${tdCls()} hidden text-soft md:table-cell`}>{relLabel(u)}</td>
                  <td className={tdCls()}>
                    <button onClick={() => toggleStatus(u)} className="cursor-pointer" title="Toggle status">
                      <Chip tone={u.status === "active" ? "pine" : "rust"}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.status === "active" ? "bg-pine-500 live-dot" : "bg-rust-500"}`} /> {u.status}
                      </Chip>
                    </button>
                  </td>
                  <td className={`${tdCls()} text-right whitespace-nowrap`}>
                    <span className="inline-flex gap-1">
                      <button onClick={() => setEdit({ ...u })} className="cursor-pointer rounded p-1.5 text-soft hover:bg-pine-100 hover:text-pine-700"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => removeUser(u)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {draft && (
        <Modal title={draft.id ? `Edit ${draft.name}` : "New user"} kicker="Authentication & access" onClose={() => setEdit(null)} wide
          footer={<><Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn><Btn onClick={save}><ShieldCheck className="h-4 w-4" /> Save user</Btn></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required><TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Email"><TextInput value={draft.email ?? ""} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Username" required><TextInput value={draft.username} onChange={(e) => set({ username: e.target.value })} className="font-mono" /></Field>
            <Field label="Password" required><TextInput value={draft.password} onChange={(e) => set({ password: e.target.value })} className="font-mono" /></Field>
            <Field label="Base role" required hint="drives relationships">
              <Select value={draft.role} onChange={(e) => { const r = e.target.value as Role; set({ role: r, roleId: defaultRoleIdFor(r), teacherId: undefined, studentId: undefined, childrenIds: r === "guardian" ? [] : undefined }); }}>
                <option value="admin">Administrator</option>
                <option value="teacher">Teacher</option>
                <option value="student">Student</option>
                <option value="guardian">Guardian</option>
              </Select>
            </Field>
            <Field label="Permission profile" required hint="drives what they can do">
              <Select value={draft.roleId} onChange={(e) => set({ roleId: e.target.value })}>
                {db.roles.filter((r) => r.status === "active" && r.appliesTo.includes(draft.role)).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.system ? "" : " · custom"}</option>
                ))}
              </Select>
            </Field>
            <Field label="Status" required>
              <Select value={draft.status} onChange={(e) => set({ status: e.target.value as UserStatus })}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </Select>
            </Field>
          </div>

          <div className="mt-4 rounded-lg border border-pine-200 bg-pine-50 p-3.5">
            <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.1em] text-pine-800">Relationship — what this account can reach</p>
            {draft.role === "teacher" && (
              <Field label="Link to staff record" hint="class access follows their subject assignments">
                <Select value={draft.teacherId ?? ""} onChange={(e) => set({ teacherId: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {db.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
            )}
            {draft.role === "student" && (
              <Field label="Link to student record" hint="class + guardian flow from the record">
                <Select value={draft.studentId ?? ""} onChange={(e) => set({ studentId: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {db.students.filter((s) => s.enrollment).map((s) => <option key={s.id} value={s.id}>{shortName(s)} · {sectionShort(db, s.enrollment!.classId, s.enrollment!.sectionId)}</option>)}
                </Select>
              </Field>
            )}
            {draft.role === "guardian" && (
              <div>
                <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Children — {(draft.childrenIds ?? []).length} selected</p>
                <div className="grid max-h-44 gap-1.5 overflow-y-auto rounded-lg border border-mist bg-card p-2 sm:grid-cols-2">
                  {db.students.filter((s) => s.enrollment).map((s) => {
                    const on = (draft.childrenIds ?? []).includes(s.id);
                    return (
                      <button key={s.id} onClick={() => set({ childrenIds: on ? (draft.childrenIds ?? []).filter((x) => x !== s.id) : [...(draft.childrenIds ?? []), s.id] })}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all ${on ? "border-gold-400 bg-gold-100/60" : "border-mist hover:border-pine-300"}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-bold text-ink">{shortName(s)}</span>
                          <span className="text-[10px] text-soft">{sectionShort(db, s.enrollment?.classId, s.enrollment?.sectionId)}</span>
                        </span>
                        {on && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-gold-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {draft.role === "admin" && <p className="text-[12px] text-pine-800">Administrators manage the whole school — users, records, settings and communication.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= profile (any role) ================= */
export function ProfilePage() {
  const { db, currentUser, update, toast, logout } = useApp();
  const nav = useNavigate();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  if (!currentUser) return null;
  const u = currentUser;

  const changePw = () => {
    if (pw.current !== u.password) { toast("Current password is incorrect.", "warn"); return; }
    if (pw.next.length < 6) { toast("New password must be at least 6 characters.", "warn"); return; }
    if (pw.next !== pw.confirm) { toast("New passwords don't match.", "warn"); return; }
    update((d) => { d.users.find((x) => x.id === u.id)!.password = pw.next; });
    setPw({ current: "", next: "", confirm: "" });
    toast("Password changed.");
  };

  const pairs = teacherPairs(db, u);
  const me = studentOf(db, u);
  const kids = childrenOf(db, u);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHead kicker="Account" title="My profile" sub="Your identity, role and the relationships that shape your access." />
      <div className="grid gap-4 md:grid-cols-5">
        <Panel className="anim-rise p-5 md:col-span-2">
          <div className="flex items-center gap-3">
            <UserAvatar name={u.name} role={u.role} size={54} />
            <div>
              <p className="font-display text-[17px] font-extrabold text-ink">{u.name}</p>
              <div className="mt-1 flex items-center gap-1.5"><RoleBadge role={u.role} full /> <Chip tone={u.status === "active" ? "pine" : "rust"}>{u.status}</Chip></div>
            </div>
          </div>
          <dl className="mt-4 space-y-2.5 text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-soft">Username</dt><dd className="font-mono font-semibold text-ink">@{u.username}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-soft">Email</dt><dd className="font-semibold text-ink">{u.email || "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-soft">Phone</dt><dd className="font-semibold text-ink">{u.phone || "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-soft">Member since</dt><dd className="font-semibold text-ink">{fmtDate(u.createdAt)}</dd></div>
          </dl>
          <div className="mt-4 rounded-lg bg-paper p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-soft"><KeyRound className="h-3.5 w-3.5" /> What I can access</p>
            <ul className="space-y-1 text-[12px] text-soft">
              {u.role === "admin" && <><li>· Every record and setting in the school</li><li>· User accounts, roles and statuses</li></>}
              {u.role === "teacher" && <>
                <li>· {pairs.length} class section{pairs.length === 1 ? "" : "s"}: {pairs.map((p) => sectionShort(db, p.classId, p.sectionId)).join(", ") || "none yet"}</li>
                <li>· Students enrolled in those sections only</li>
              </>}
              {u.role === "student" && <>
                <li>· My record: {me ? `${shortName(me)} · ${sectionShort(db, me.enrollment?.classId, me.enrollment?.sectionId)}` : "not linked"}</li>
                <li>· My grades, attendance, assignments & teachers</li>
              </>}
              {u.role === "guardian" && <>
                <li>· {kids.length} child{kids.length === 1 ? "" : "ren"}: {kids.map((k) => shortName(k)).join(", ") || "none yet"}</li>
                <li>· Their grades, attendance & assignments only</li>
              </>}
            </ul>
          </div>
        </Panel>

        <Panel className="anim-rise p-5 md:col-span-3">
          <h2 className="font-display text-[15px] font-bold">Change password</h2>
          <p className="mt-0.5 text-[11.5px] text-soft">Credentials are checked against this account only — one authentication system for every role.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Current"><TextInput type="password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} className="font-mono" /></Field>
            <Field label="New"><TextInput type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} className="font-mono" /></Field>
            <Field label="Confirm new"><TextInput type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} className="font-mono" /></Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={changePw}><Lock className="h-4 w-4" /> Update password</Btn>
            <Btn variant="outline" onClick={() => { logout(); nav("/login", { replace: true }); }}><X className="h-4 w-4" /> Sign out</Btn>
          </div>

          {u.role === "teacher" && (
            <div className="mt-6 border-t border-mist pt-4">
              <h3 className="mb-2 font-display text-[14px] font-bold">My classes</h3>
              <div className="flex flex-wrap gap-1.5">
                {pairs.map((p) => (
                  <Chip key={p.classId + p.sectionId} tone="pine" className="!text-[11.5px]">
                    <Layers className="h-3 w-3" /> {sectionShort(db, p.classId, p.sectionId)} · {p.subjectIds.map((s) => getSubject(db, s)?.code).join("/")}
                  </Chip>
                ))}
                {pairs.length === 0 && <Chip tone="gray">No assignments yet</Chip>}
              </div>
            </div>
          )}
          {u.role === "guardian" && (
            <div className="mt-6 border-t border-mist pt-4">
              <h3 className="mb-2 font-display text-[14px] font-bold">My children</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {kids.map((k) => (
                  <button key={k.id} onClick={() => nav(`/guardian/children/${k.id}`)} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-mist bg-paper/60 px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-gold-400 hover:shadow-md">
                    <Avatar student={k} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink">{shortName(k)}</span>
                      <span className="text-[10.5px] text-soft">{sectionShort(db, k.enrollment?.classId, k.enrollment?.sectionId)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {u.role === "student" && me && (
            <div className="mt-6 border-t border-mist pt-4">
              <h3 className="mb-2 font-display text-[14px] font-bold">My placement</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="pine" className="!text-[11.5px]"><BookOpen className="h-3 w-3" /> {sectionLabel(db, me.enrollment?.classId, me.enrollment?.sectionId)}</Chip>
                <Chip tone="gray" className="font-mono">{me.regId}</Chip>
                <Chip tone="gold">Avg {studentAverage(db, me) ?? "—"}%</Chip>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
