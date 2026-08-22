import { supabase, isSupabaseConfigured } from "./supabase";
import { PROJECT_REF } from "./migrations";
import { buildSeed } from "../data/seed";
import type {
  DB, User, Student, Enrollment, StudentDoc, AssessmentStructure, AssessmentItem, AttendanceRecord,
  Announcement, Conversation, Message, AppNotification, SchoolEvent, AuditEntry, RoleDef,
} from "../types";

/**
 * Backend adapter — the single place where the in-memory `DB` shape meets the
 * real Supabase/PostgreSQL schema.
 *
 *  - hydrate()  : loads every collection through the anon client. Row Level
 *                 Security on the server decides what THIS user may see; the
 *                 client never filters for security, only for shape.
 *  - sync()     : diffs an old DB snapshot against a new one and applies the
 *                 delta (upsert / delete) to PostgreSQL. This lets the whole
 *                 app keep calling `update((d) => …)` unchanged.
 *
 * Identity model after migration:
 *  - `User.id` is the profiles row UUID (== auth.users.id). Every user
 *    reference (senderId, participants, readBy, childrenIds guardian side) is
 *    a UUID and stays internally consistent because it all hydrates together.
 *  - Domain entities (teachers t1, students st1, classes c8, …) keep their
 *    short text ids — the schema uses text PKs for exactly this reason.
 */

const SCHOOL_ID = "school-1";
const sb = () => supabase;

export type DbMode = "live" | "local" | "off";

/**
 * Probe the remote schema without writing anything. Distinguishes:
 *   live    — tables exist (data may be empty)
 *   missing — reachable project, migrations not applied (PGRST205 / 42P01)
 *   off     — client not configured
 */
export async function checkSchema(): Promise<DbMode | "missing"> {
  if (!isSupabaseConfigured) return "off";
  const { error } = await sb()!.from("schools").select("id").limit(1);
  if (!error) return "live";
  const code = (error as { code?: string }).code ?? "";
  const msg = error.message ?? "";
  if (code === "PGRST205" || code === "42P01" || /does not exist|Could not find the table/i.test(msg)) return "missing";
  console.warn("[backend] schema probe failed:", msg);
  return "missing";
}

/**
 * Apply the bundled migrations through the Supabase Management API.
 * The service key is supplied at runtime by the operator, lives only in
 * browser memory, and is never persisted or bundled. If the browser blocks
 * the call (CORS), the console falls back to the guided SQL-Editor path.
 */
export async function applyMigrations(
  serviceKey: string,
  files: { file: string; sql: string }[],
  onStep: (file: string, state: "run" | "ok" | "fail", detail?: string) => void
): Promise<boolean> {
  const endpoint = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  for (const m of files) {
    onStep(m.file, "run");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: m.sql }),
      });
      const text = await res.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
      if (!res.ok || body?.error) {
        const detail = body?.error ?? body?.message ?? `HTTP ${res.status}`;
        onStep(m.file, "fail", String(detail).slice(0, 160));
        return false;
      }
      onStep(m.file, "ok");
    } catch {
      onStep(m.file, "fail", "Browser blocked the direct API call — use the guided SQL Editor path below.");
      return false;
    }
  }
  return true;
}

/* =========================================================================
   hydrate — Supabase → DB shape
   ========================================================================= */

async function sel<T = any>(table: string, select = "*"): Promise<T[] | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await sb()!.from(table).select(select);
  if (error) {
    console.warn(`[backend] could not read ${table}:`, error.message);
    return null;
  }
  return (data as T[]) ?? [];
}

export async function hydrate(): Promise<{ db: DB; mode: DbMode; schemaMissing: boolean }> {
  const seed = buildSeed();
  const probe = await checkSchema();
  if (probe === "off") return { db: seed, mode: "off", schemaMissing: false };
  if (probe === "missing") return { db: seed, mode: "local", schemaMissing: true };

  // Parallel reads; any table that fails (e.g. migration not yet applied)
  // falls back to the seed so the UI still renders — loudly, not silently.
  const [
    schools, years, classes, sections, subjects, teachers, assignments,
    students, enrollments, documents, structures, items, marks, submissions,
    gradeBands, registers, entries, fees, homework, timetable,
    roleDefs, rolePerms, profiles, guardianStudents,
    announcements, announcementReads, conversations, participants,
    messages, notifications, events, audit,
  ] = await Promise.all([
    sel("schools"), sel("academic_years"), sel("classes"), sel("sections"),
    sel("subjects"), sel("teachers"), sel("teacher_assignments"),
    sel("students"), sel("enrollments"), sel("student_documents"),
    sel("assessment_structures"), sel("assessment_items"), sel("assessment_marks"),
    sel("mark_submissions"), sel("grade_bands"), sel("attendance_registers"),
    sel("attendance_entries"), sel("fee_items"), sel("homework"), sel("timetable_entries"),
    sel("role_defs"), sel("role_permissions"), sel("profiles"), sel("guardian_students"),
    sel("announcements"), sel("announcement_reads"), sel("conversations"),
    sel("conversation_participants"), sel("messages"), sel("notifications"),
    sel("events"), sel("audit_log"),
  ]);

  const db: DB = seed;
  let remote = false;

  if (schools) {
    remote = true;
    const s = schools.find((x: any) => x.id === SCHOOL_ID);
    if (s) db.settings = { schoolName: s.name, motto: s.motto ?? "" };
  }
  if (years) db.years = years.map((y: any) => ({ id: y.id, name: y.name, start: y.start_date, end: y.end_date, active: y.is_active }));
  if (classes && sections) {
    db.classes = classes.map((c: any) => ({
      id: c.id, name: c.name, level: c.level,
      sections: sections.filter((s: any) => s.class_id === c.id).map((s: any) => ({ id: s.id, name: s.name })),
    }));
  }
  if (subjects) db.subjects = subjects.map((s: any) => ({ id: s.id, name: s.name, code: s.code, color: s.color }));
  if (teachers) db.teachers = teachers.map((t: any) => ({ id: t.id, name: t.name, phone: t.phone, email: t.email, specialty: t.specialty }));
  if (assignments) db.assignments = assignments.map((a: any) => ({ id: a.id, yearId: a.year_id, classId: a.class_id, sectionId: a.section_id, subjectId: a.subject_id, teacherId: a.teacher_id }));

  if (students) {
    const enr = enrollments ?? [];
    const docs = documents ?? [];
    db.students = students.map((s: any) => {
      const hist: Enrollment[] = enr
        .filter((e: any) => e.student_id === s.id)
        .map((e: any) => ({ yearId: e.year_id, classId: e.class_id, sectionId: e.section_id, rollNumber: e.roll_number, status: e.status, enrolledOn: e.enrolled_on }));
      const activeYear = years?.find((y: any) => y.is_active)?.id;
      const current = hist.find((h) => h.yearId === activeYear) ?? hist[hist.length - 1];
      const sd: StudentDoc[] = docs.filter((d: any) => d.student_id === s.id)
        .map((d: any) => ({ id: d.id, name: d.name, kind: d.kind, size: d.size, date: d.doc_date }));
      return {
        id: s.id, regId: s.reg_no,
        firstName: s.first_name, middleName: s.middle_name, lastName: s.last_name,
        gender: s.gender, dob: s.dob, phone: s.phone, email: s.email, address: s.address,
        photo: s.photo_path || undefined,
        guardian: { father: s.guardian_name ?? "", mother: s.mother_name, relation: s.guardian_relation ?? "Father", phone: s.guardian_phone, address: s.guardian_address },
        admission: { number: s.admission_no ?? "", date: s.admission_date, previousSchool: s.previous_school, type: s.admission_type ?? "New Admission" },
        enrollment: current, history: hist, documents: sd,
      } as Student;
    });
  }

  if (structures && items) {
    db.structures = structures.map((st: any) => ({
      id: st.id, yearId: st.year_id, classId: st.class_id, subjectId: st.subject_id, period: termName(st.term_id),
      items: items.filter((i: any) => i.structure_id === st.id).sort((a: any, b: any) => a.sort - b.sort)
        .map((i: any) => ({ id: i.id, name: i.name, max: Number(i.max_mark), weight: Number(i.weight) })),
    })) as AssessmentStructure[];
  }

  if (marks) {
    const am: DB["assessmentMarks"] = {};
    for (const m of marks as any[]) {
      am[m.structure_id] = am[m.structure_id] ?? {};
      am[m.structure_id][m.student_id] = am[m.structure_id][m.student_id] ?? {};
      am[m.structure_id][m.student_id][m.item_id] = Number(m.raw_mark);
    }
    db.assessmentMarks = am;
  }

  if (submissions) db.submissions = (submissions as any[]).map((s) => ({
    id: s.id, structureId: s.structure_id, status: s.status,
    submittedBy: s.submitted_by, submittedAt: s.submitted_at,
    approvedBy: s.approved_by, approvedAt: s.approved_at,
    returnedBy: s.returned_by, returnedAt: s.returned_at, returnReason: s.return_reason,
    publishedBy: s.published_by, publishedAt: s.published_at,
  }));

  if (gradeBands) db.grading = (gradeBands as any[]).sort((a, b) => a.sort - b.sort)
    .map((g) => ({ min: Number(g.min_pct), max: Number(g.max_pct), grade: g.grade, remark: g.remark }));

  if (registers && entries) {
    db.attendance = (registers as any[]).map((r) => {
      const marks: AttendanceRecord["marks"] = {};
      for (const e of entries as any[]) if (e.register_id === r.id) marks[e.student_id] = e.status;
      return { date: r.day, classId: r.class_id, sectionId: r.section_id, marks } as AttendanceRecord;
    });
  }

  if (fees) db.fees = (fees as any[]).map((f) => ({ id: f.id, studentId: f.student_id, label: f.label, amount: Number(f.amount), paid: Number(f.paid), due: f.due_date, payments: f.payments ?? [] }));
  if (homework) db.homework = (homework as any[]).map((h) => ({ id: h.id, yearId: h.year_id, classId: h.class_id, sectionId: h.section_id, subjectId: h.subject_id, title: h.title, description: h.description, issued: h.issued, due: h.due, submitted: h.submitted_students ?? [] }));
  if (timetable) db.timetable = (timetable as any[]).map((t) => ({ id: t.id, classId: t.class_id, sectionId: t.section_id, day: t.day, period: t.period, subjectId: t.subject_id, room: t.room }));

  if (roleDefs) {
    const perms = rolePerms ?? [];
    db.roles = (roleDefs as any[]).map((r) => ({
      id: r.id, name: r.name, description: r.description, system: r.is_system, appliesTo: r.applies_to ?? [], status: r.status,
      permissions: r.all_permissions ? ["*"] : (perms as any[]).filter((p) => p.role_def_id === r.id).map((p) => p.permission_id),
    })) as RoleDef[];
  }

  if (profiles) {
    const gs = guardianStudents ?? [];
    db.users = (profiles as any[]).map((p) => ({
      id: p.id, name: p.full_name, username: p.username, password: "",
      role: p.role, roleId: p.role_def_id, status: p.status,
      email: p.email, phone: p.phone, teacherId: p.teacher_id, studentId: p.student_id,
      childrenIds: p.role === "guardian" ? (gs as any[]).filter((g) => g.guardian_id === p.id).map((g) => g.student_id) : undefined,
      createdAt: p.created_at,
    })) as User[];
  }

  if (announcements) {
    const reads = announcementReads ?? [];
    db.announcements = (announcements as any[]).map((a) => ({
      id: a.id, title: a.title, body: a.body, category: a.category, senderId: a.sender_id,
      audience: a.audience, status: a.status, createdAt: a.created_at, scheduledFor: a.scheduled_for,
      publishedAt: a.published_at, pinned: a.pinned,
      readBy: (reads as any[]).filter((r) => r.announcement_id === a.id).map((r) => r.profile_id),
    })) as Announcement[];
  }

  if (conversations) {
    const parts = participants ?? [];
    db.conversations = (conversations as any[]).map((c) => ({
      id: c.id, type: "direct" as const,
      participants: (parts as any[]).filter((p) => p.conversation_id === c.id).map((p) => p.profile_id),
      relatedStudentId: c.related_student_id, relatedClassId: c.related_class_id,
      relatedSectionId: c.related_section_id, relatedSubjectId: c.related_subject_id,
      createdAt: c.created_at, updatedAt: c.updated_at, status: c.status,
    })) as Conversation[];
  }

  if (messages) db.messages = (messages as any[]).map((m) => ({
    id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, body: m.body,
    createdAt: m.created_at, readBy: m.read_by ?? [], status: (m.read_by?.length ?? 0) > 1 ? "read" : "sent",
  })) as Message[];

  if (notifications) db.notifications = (notifications as any[]).map((n) => ({
    id: n.id, userId: n.profile_id, type: n.type, title: n.title, body: n.body, at: n.created_at, read: n.is_read,
  })) as AppNotification[];

  if (events) db.events = (events as any[]).map((e) => ({
    id: e.id, title: e.title, description: e.description, date: e.day, time: e.time_of_day,
    location: e.location, category: e.category, audience: e.audience, createdBy: e.created_by,
  })) as SchoolEvent[];

  if (audit) db.audit = (audit as any[]).map((a) => ({
    id: a.id, userId: a.actor_id, userName: a.actor_name, action: a.action, target: a.target, detail: a.detail, at: a.at,
  })) as AuditEntry[];

  return { db, mode: remote ? "live" : "local", schemaMissing: false };
}

function termName(termId: string | null | undefined): string {
  if (!termId) return "Annual";
  if (termId.includes("s1")) return "Semester 1";
  if (termId.includes("s2")) return "Semester 2";
  return "Annual";
}

/* =========================================================================
   sync — DB-diff → PostgreSQL
   ========================================================================= */

async function upsert(table: string, rows: any[], onConflict?: string, errors?: string[]) {
  if (!rows.length || !isSupabaseConfigured) return;
  const q = sb()!.from(table).upsert(rows, { onConflict, ignoreDuplicates: false });
  const { error } = await q;
  if (error) { console.warn(`[backend] upsert ${table} failed:`, error.message); errors?.push(`${table}: ${error.message}`); }
}
async function remove(table: string, ids: string[], errors?: string[]) {
  if (!ids.length || !isSupabaseConfigured) return;
  const { error } = await sb()!.from(table).delete().in("id", ids);
  if (error) { console.warn(`[backend] delete ${table} failed:`, error.message); errors?.push(`${table}: ${error.message}`); }
}

function diff<T extends { id: string }>(oldR: T[], newR: T[], key: (r: T) => string = (r) => r.id) {
  const om = new Map(oldR.map((r) => [key(r), r]));
  const nm = new Map(newR.map((r) => [key(r), r]));
  const up: T[] = [];
  for (const [k, r] of nm) {
    const o = om.get(k);
    if (!o || JSON.stringify(o) !== JSON.stringify(r)) up.push(r);
  }
  const del = [...om.keys()].filter((k) => !nm.has(k));
  return { up, del };
}

/** Serialize the full DB into flat row-sets keyed by table. */
function rowsOf(db: DB) {
  const R: Record<string, any[]> = {
    academic_years: db.years.map((y) => ({ id: y.id, school_id: SCHOOL_ID, name: y.name, start_date: y.start, end_date: y.end, is_active: y.active })),
    classes: db.classes.map((c) => ({ id: c.id, school_id: SCHOOL_ID, name: c.name, level: c.level })),
    sections: db.classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, class_id: c.id, name: s.name }))),
    subjects: db.subjects.map((s) => ({ id: s.id, school_id: SCHOOL_ID, code: s.code, name: s.name, color: s.color })),
    teachers: db.teachers.map((t) => ({ id: t.id, school_id: SCHOOL_ID, name: t.name, phone: t.phone, email: t.email, specialty: t.specialty })),
    teacher_assignments: db.assignments.map((a) => ({ id: a.id, year_id: a.yearId, class_id: a.classId, section_id: a.sectionId, subject_id: a.subjectId, teacher_id: a.teacherId })),
    students: db.students.map((s) => ({
      id: s.id, school_id: SCHOOL_ID, reg_no: s.regId, admission_no: s.admission.number,
      first_name: s.firstName, middle_name: s.middleName, last_name: s.lastName, gender: s.gender,
      dob: s.dob, phone: s.phone, email: s.email, address: s.address, status: (s as any).status ?? "active",
      guardian_name: s.guardian.father, guardian_relation: s.guardian.relation, guardian_phone: s.guardian.phone,
      guardian_address: s.guardian.address, mother_name: s.guardian.mother,
      admission_date: s.admission.date, previous_school: s.admission.previousSchool, admission_type: s.admission.type,
      photo_path: s.photo ?? null,
    })),
    enrollments: db.students.flatMap((s) => s.history.map((h) => ({
      id: `${s.id}|${h.yearId}`, student_id: s.id, year_id: h.yearId, class_id: h.classId,
      section_id: h.sectionId, roll_number: h.rollNumber ?? null,
      status: h.status ?? (s.enrollment?.yearId === h.yearId ? "active" : "active"),
      enrolled_on: h.enrolledOn ?? null,
    }))),
    student_documents: db.students.flatMap((s) => s.documents.map((d) => ({
      id: d.id, student_id: s.id, name: d.name, kind: d.kind, size: d.size, doc_date: d.date, storage_path: null,
    }))),
    assessment_structures: db.structures.map((st) => ({ id: st.id, year_id: st.yearId, class_id: st.classId, subject_id: st.subjectId, term_id: termId(st.period) })),
    assessment_items: db.structures.flatMap((st) => st.items.map((i, idx) => ({ id: i.id, structure_id: st.id, name: i.name, max_mark: i.max, weight: i.weight, sort: idx }))),
    mark_submissions: db.submissions.map((s) => ({
      id: s.id, structure_id: s.structureId, status: s.status,
      submitted_by: s.submittedBy, submitted_at: s.submittedAt,
      approved_by: s.approvedBy, approved_at: s.approvedAt,
      returned_by: s.returnedBy, returned_at: s.returnedAt, return_reason: s.returnReason,
      published_by: s.publishedBy, published_at: s.publishedAt,
    })),
    grade_bands: db.grading.map((g, i) => ({ id: `gb${i + 1}`, school_id: SCHOOL_ID, min_pct: g.min, max_pct: g.max, grade: g.grade, remark: g.remark, sort: i })),
    fee_items: db.fees.map((f) => ({ id: f.id, student_id: f.studentId, label: f.label, amount: f.amount, paid: f.paid, due_date: f.due, payments: f.payments ?? [] })),
    homework: db.homework.map((h) => ({ id: h.id, year_id: h.yearId, class_id: h.classId, section_id: h.sectionId, subject_id: h.subjectId, title: h.title, description: h.description, issued: h.issued, due: h.due, submitted_students: h.submitted })),
    timetable_entries: db.timetable.map((t) => ({ id: t.id, class_id: t.classId, section_id: t.sectionId, day: t.day, period: t.period, subject_id: t.subjectId, room: t.room })),
    role_defs: db.roles.map((r) => ({ id: r.id, name: r.name, description: r.description, is_system: r.system, all_permissions: r.permissions.includes("*"), applies_to: r.appliesTo, status: r.status })),
    announcements: db.announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, category: a.category, sender_id: a.senderId, audience: a.audience, status: a.status, scheduled_for: a.scheduledFor, published_at: a.publishedAt, pinned: a.pinned ?? false })),
    conversations: db.conversations.map((c) => ({ id: c.id, related_student_id: c.relatedStudentId, related_class_id: c.relatedClassId, related_section_id: c.relatedSectionId, related_subject_id: c.relatedSubjectId, status: c.status })),
    events: db.events.map((e) => ({ id: e.id, title: e.title, description: e.description, day: e.date, time_of_day: e.time, location: e.location, category: e.category, audience: e.audience, created_by: e.createdBy })),
  };
  return R;
}

function termId(period: string): string | null {
  if (period === "Semester 1") return "y26-s1";
  if (period === "Semester 2") return "y26-s2";
  return null;
}

let chain: Promise<void> = Promise.resolve();

/** Queue a diff-sync so rapid `update()` calls never interleave. */
/**
 * sync() queues onto a shared chain so writes apply in order, but each call
 * gets its OWN errors array — concurrent update()s never bleed their error
 * lists into each other. The returned promise resolves with exactly the
 * errors this call's writes produced (empty array = everything landed).
 */
export function sync(oldDB: DB, newDB: DB): Promise<string[]> {
  if (!isSupabaseConfigured) return Promise.resolve([]);
  const errors: string[] = [];
  const run = chain.then(() => doSync(oldDB, newDB, errors)).catch((e) => { console.warn("[backend] sync error", e); errors.push(String(e?.message ?? e)); });
  chain = run;
  return run.then(() => errors);
}

async function doSync(oldDB: DB, newDB: DB, errors: string[]): Promise<void> {
  const o = rowsOf(oldDB);
  const n = rowsOf(newDB);

  // Order matters for FKs: parents before children.
  const ordered = [
    "academic_years", "classes", "sections", "subjects", "teachers", "students",
    "teacher_assignments", "enrollments", "student_documents",
    "assessment_structures", "assessment_items", "grade_bands",
    "fee_items", "homework", "timetable_entries", "role_defs",
    "announcements", "conversations", "events",
  ];
  for (const table of ordered) {
    const { up, del } = diff(o[table] ?? [], n[table] ?? []);
    if (up.length) await upsert(table, up, undefined, errors);
    if (del.length) await remove(table, del, errors);
  }

  // settings → single schools row
  if (JSON.stringify(oldDB.settings) !== JSON.stringify(newDB.settings)) {
    await upsert("schools", [{ id: SCHOOL_ID, name: newDB.settings.schoolName, motto: newDB.settings.motto }], undefined, errors);
  }

  // marks (flattened triple-nested map) — keyed by structure|item|student
  const flatMarks = (db: DB) => {
    const out: any[] = [];
    for (const [sid, byStudent] of Object.entries(db.assessmentMarks))
      for (const [stid, byItem] of Object.entries(byStudent))
        for (const [iid, v] of Object.entries(byItem))
          out.push({ id: `${sid}|${iid}|${stid}`, structure_id: sid, item_id: iid, student_id: stid, raw_mark: v, entered_by: newDB ? currentProfileId() : null });
    return out;
  };
  {
    const { up, del } = diff(flatMarks(oldDB), flatMarks(newDB));
    if (up.length) await upsert("assessment_marks", up.map(({ id: _id, ...r }) => r), "item_id,student_id", errors);
    // deletes on marks: item_id+student combos removed
    if (del.length) {
      const combos = del.map((k) => k.split("|"));
      for (const [sid, iid, stid] of combos) {
        const { error } = await sb()!.from("assessment_marks").delete().eq("structure_id", sid).eq("item_id", iid).eq("student_id", stid);
        if (error) errors.push(`assessment_marks: ${error.message}`);
      }
    }
  }

  // attendance registers + entries (replace-per-register)
  {
    const regRows = newDB.attendance.map((r) => ({ id: regId(r), day: r.date, class_id: r.classId, section_id: r.sectionId, recorded_by: currentProfileId() }));
    const changedRegs = newDB.attendance.filter((r) => {
      const oReg = oldDB.attendance.find((x) => x.date === r.date && x.classId === r.classId && x.sectionId === r.sectionId);
      return JSON.stringify(oReg?.marks) !== JSON.stringify(r.marks);
    });
    for (const r of changedRegs) {
      const rid = regId(r);
      const regRow = regRows.find((x) => x.id === rid);
      if (regRow) await upsert("attendance_registers", [regRow], undefined, errors);
      const entries = Object.entries(r.marks).map(([stid, status]) => ({ id: `${rid}|${stid}`, register_id: rid, student_id: stid, status }));
      const { error: delErr } = await sb()!.from("attendance_entries").delete().eq("register_id", rid);
      if (delErr) errors.push(`attendance_entries: ${delErr.message}`);
      await upsert("attendance_entries", entries, undefined, errors);
    }
  }

  // role_permissions (replace per role when a role's permission set changes)
  for (const role of newDB.roles) {
    const before = oldDB.roles.find((r) => r.id === role.id);
    if (JSON.stringify(before?.permissions) !== JSON.stringify(role.permissions) && !role.permissions.includes("*")) {
      const { error: delErr } = await sb()!.from("role_permissions").delete().eq("role_def_id", role.id);
      if (delErr) errors.push(`role_permissions: ${delErr.message}`);
      await upsert("role_permissions", role.permissions.map((p) => ({ role_def_id: role.id, permission_id: p })), undefined, errors);
    }
  }

  // communication child tables
  await syncReads("announcement_reads", oldDB.announcements, newDB.announcements, (a) => a.id, (a) => a.readBy ?? [], "announcement_id", errors);
  await syncParticipants(oldDB, newDB, errors);
  await syncMessages(oldDB, newDB, errors);
  await syncNotifications(oldDB, newDB, errors);
  await syncProfiles(oldDB, newDB, errors);
}

function regId(r: AttendanceRecord) {
  return `reg|${r.date}|${r.classId}|${r.sectionId}`;
}

async function syncReads(
  table: string,
  oldList: { id: string; readBy?: string[] }[],
  newList: { id: string; readBy?: string[] }[],
  getId: (x: any) => string,
  getReads: (x: any) => string[],
  fk: string,
  errors: string[],
) {
  for (const item of newList) {
    const before = oldList.find((x) => getId(x) === getId(item));
    const now = getReads(item);
    const prev = before ? getReads(before) : [];
    const added = now.filter((p) => !prev.includes(p));
    if (added.length) await upsert(table, added.map((p) => ({ [fk]: getId(item), profile_id: p })), undefined, errors);
  }
}

async function syncParticipants(oldDB: DB, newDB: DB, errors: string[]) {
  for (const c of newDB.conversations) {
    const before = oldDB.conversations.find((x) => x.id === c.id);
    const added = c.participants.filter((p) => !(before?.participants ?? []).includes(p));
    if (added.length) await upsert("conversation_participants", added.map((p) => ({ conversation_id: c.id, profile_id: p })), undefined, errors);
  }
}

async function syncMessages(oldDB: DB, newDB: DB, errors: string[]) {
  const { up } = diff(oldDB.messages, newDB.messages);
  for (const m of up) {
    await upsert("messages", [{ id: m.id, conversation_id: m.conversationId, sender_id: m.senderId, body: m.body, read_by: m.readBy, created_at: m.createdAt }], undefined, errors);
  }
}

async function syncNotifications(oldDB: DB, newDB: DB, errors: string[]) {
  const { up } = diff(oldDB.notifications, newDB.notifications);
  for (const nnt of up) {
    await upsert("notifications", [{ id: nnt.id, profile_id: nnt.userId, type: nnt.type, title: nnt.title, body: nnt.body, is_read: nnt.read, created_at: nnt.at }], undefined, errors);
  }
}

/**
 * Profiles are Auth-managed. We sync editable fields (name, role, links) but
 * NEVER a password — new accounts go through the create_user_account RPC and
 * passwords only ever touch Supabase Auth.
 */
async function syncProfiles(oldDB: DB, newDB: DB, errors: string[]) {
  for (const u of newDB.users) {
    const before = oldDB.users.find((x) => x.id === u.id);
    if (!before) {
      // NEW account → created server-side via the create_user_account RPC
      // (SECURITY DEFINER, gated by users.manage). The plaintext password is
      // handed to Supabase Auth once and never stored anywhere.
      if (!u.username?.trim() || !u.password) continue;
      // A blank string is not the same as "no email" to SQL's coalesce() —
      // send null so the RPC's own username@school fallback actually applies.
      const email = u.email?.trim() ? u.email.trim() : null;
      const { data: newId, error } = await sb()!.rpc("create_user_account", {
        p_username: u.username.trim(), p_password: u.password, p_full_name: u.name,
        p_role: u.role, p_role_def_id: u.roleId,
        p_teacher_id: u.teacherId ?? null, p_student_id: u.studentId ?? null,
        p_email: email, p_phone: u.phone ?? null,
      });
      if (error) { console.warn("[backend] create_user_account:", error.message); errors.push(`login for ${u.name}: ${error.message}`); continue; }
      if (u.role === "guardian" && u.childrenIds?.length && newId) {
        await upsert("guardian_students", u.childrenIds.map((sid) => ({ guardian_id: newId as string, student_id: sid, relation: "Guardian" })), undefined, errors);
      }
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(u)) continue;
    const { error: updErr } = await sb()!.from("profiles").update({
      full_name: u.name, username: u.username, email: u.email, phone: u.phone,
      role: u.role, role_def_id: u.roleId, status: u.status,
      teacher_id: u.teacherId ?? null, student_id: u.studentId ?? null,
    }).eq("id", u.id);
    if (updErr) errors.push(`profile ${u.name}: ${updErr.message}`);
    // guardian children → junction table replace
    if (u.role === "guardian") {
      const beforeKids = before.childrenIds ?? [];
      const nowKids = u.childrenIds ?? [];
      if (JSON.stringify(beforeKids) !== JSON.stringify(nowKids)) {
        const { error: delErr } = await sb()!.from("guardian_students").delete().eq("guardian_id", u.id);
        if (delErr) errors.push(`guardian_students: ${delErr.message}`);
        await upsert("guardian_students", nowKids.map((sid) => ({ guardian_id: u.id, student_id: sid, relation: "Guardian" })), undefined, errors);
      }
    }
  }
}

/* =========================================================================
   session helpers
   ========================================================================= */

let _profileId: string | null = null;
export const setProfileId = (id: string | null) => { _profileId = id; };
export const currentProfileId = () => _profileId;

export async function loadProfileForSession(userId: string): Promise<User | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await sb()!.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!data) return null;
  const { data: gs } = await sb()!.from("guardian_students").select("student_id").eq("guardian_id", userId);
  return {
    id: data.id, name: data.full_name, username: data.username, password: "",
    role: data.role, roleId: data.role_def_id, status: data.status,
    email: data.email, phone: data.phone, teacherId: data.teacher_id, studentId: data.student_id,
    childrenIds: data.role === "guardian" ? (gs ?? []).map((g: any) => g.student_id) : undefined,
    createdAt: data.created_at,
  } as User;
}
