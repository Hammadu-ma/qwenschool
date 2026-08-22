import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AssessmentStructure, Audience, DB, Role, Student, User,
} from "./types";
import { buildSeed } from "./data/seed";
import { supabase, isSupabaseConfigured, usernameToEmail } from "./lib/supabase";
import { hydrate, sync, setProfileId, loadProfileForSession, type DbMode } from "./lib/backend";

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Turns update()'s raw sync-error list into one clear sentence. Login-account
 *  failures (tagged "login for X: …" in backend.ts) are common and recoverable
 *  — the record itself still saved — so they're worded differently from a
 *  failure to save the record itself. */
export function describeSyncErrors(errors: string[]): string {
  if (!errors.length) return "";
  const core = errors.find((e) => !e.startsWith("login for "));
  if (core) return `Saved, but something didn't sync: ${core}`;
  const loginMsg = errors[0].replace(/^login for [^:]+: /, "");
  return `Saved — but the login account could not be created: ${loginMsg}`;
}
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (isoStr: string) =>
  new Date(isoStr + (isoStr.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const fmtShort = (isoStr: string) =>
  new Date(isoStr + (isoStr.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const timeAgo = (isoStr: string) => {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
};
export const fmt1 = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/* ================= lookups ================= */
export const getYear = (db: DB, id?: string) => db.years.find((y) => y.id === id);
export const getClass = (db: DB, id?: string) => db.classes.find((c) => c.id === id);
export const getSection = (db: DB, classId?: string, sectionId?: string) =>
  getClass(db, classId)?.sections.find((s) => s.id === sectionId);
export const getSubject = (db: DB, id?: string) => db.subjects.find((s) => s.id === id);
export const getTeacher = (db: DB, id?: string) => db.teachers.find((t) => t.id === id);
export const sectionLabel = (db: DB, classId?: string, sectionId?: string) => {
  const c = getClass(db, classId);
  const s = getSection(db, classId, sectionId);
  return c && s ? `${c.name} — Section ${s.name}` : "—";
};
export const sectionShort = (db: DB, classId?: string, sectionId?: string) => {
  const c = getClass(db, classId);
  const s = getSection(db, classId, sectionId);
  return c && s ? `${c.name} · ${s.name}` : "—";
};
export const fullName = (s: Student) => `${s.firstName} ${s.middleName} ${s.lastName}`;
export const shortName = (s: Student) => `${s.firstName} ${s.lastName}`;
export const initials = (s: Student) => `${s.firstName[0] ?? ""}${s.lastName[0] ?? ""}`;
export const studentsOf = (db: DB, classId?: string, sectionId?: string) =>
  db.students.filter(
    (s) => s.enrollment && (!classId || s.enrollment.classId === classId) && (!sectionId || s.enrollment.sectionId === sectionId)
  );
export const teacherFor = (db: DB, yearId: string, classId: string, sectionId: string | undefined, subjectId: string) => {
  const a = db.assignments.find(
    (x) => x.yearId === yearId && x.classId === classId && x.subjectId === subjectId && (!sectionId || x.sectionId === sectionId)
  );
  return a ? getTeacher(db, a.teacherId) : undefined;
};

/* ================= domain math ================= */
export const gradeFor = (pct: number, grading: DB["grading"]) =>
  grading.find((b) => pct >= b.min && pct <= b.max) ?? { min: 0, max: 0, grade: "—", remark: "" };

export const attendanceStats = (db: DB, studentId: string) => {
  let present = 0, absent = 0, late = 0;
  for (const r of db.attendance) {
    const m = r.marks[studentId];
    if (m === "present") present++;
    else if (m === "absent") absent++;
    else if (m === "late") late++;
  }
  const total = present + absent + late;
  return { present, absent, late, total, pct: total ? Math.round(((present + late * 0.5) / total) * 100) : 0 };
};

export const structureWeightSum = (st: AssessmentStructure) => st.items.reduce((s, i) => s + i.weight, 0);

export interface ACalc {
  raw: Record<string, number>;
  total: number;
  pct: number;
  complete: boolean;
}

export const assessmentCalc = (db: DB, st: AssessmentStructure, studentId: string): ACalc | null => {
  const row = db.assessmentMarks[st.id]?.[studentId];
  if (!row) return null;
  let total = 0;
  let complete = true;
  const raw: Record<string, number> = {};
  for (const it of st.items) {
    const v = row[it.id];
    if (v == null) { complete = false; continue; }
    raw[it.id] = v;
    if (it.max > 0) total += (v / it.max) * it.weight;
  }
  const ws = structureWeightSum(st);
  return { raw, total: +total.toFixed(2), pct: ws > 0 ? +((total / ws) * 100).toFixed(2) : 0, complete };
};

export const structureRanks = (db: DB, st: AssessmentStructure): Record<string, number> => {
  const list = studentsOf(db, st.classId)
    .map((s) => ({ id: s.id, calc: assessmentCalc(db, st, s.id) }))
    .filter((x): x is { id: string; calc: ACalc } => x.calc != null && x.calc.complete)
    .sort((a, b) => b.calc.pct - a.calc.pct);
  const out: Record<string, number> = {};
  list.forEach((x, i) => {
    if (i > 0 && Math.round(x.calc.pct * 100) === Math.round(list[i - 1].calc.pct * 100)) out[x.id] = out[list[i - 1].id];
    else out[x.id] = i + 1;
  });
  return out;
};

/** Average percentage across all structures for a student (their "grades"). */
export const studentResults = (db: DB, student: Student) => {
  if (!student.enrollment) return [];
  return db.structures
    .filter((st) => st.yearId === student.enrollment!.yearId && st.classId === student.enrollment!.classId)
    .map((st) => ({ st, calc: assessmentCalc(db, st, student.id) }))
    .filter((x) => x.calc != null)
    .map((x) => ({ st: x.st, calc: x.calc!, subject: getSubject(db, x.st.subjectId) }));
};

export const studentAverage = (db: DB, student: Student): number | null => {
  const res = studentResults(db, student).filter((r) => r.calc.complete);
  if (!res.length) return null;
  return +(res.reduce((s, r) => s + r.calc.pct, 0) / res.length).toFixed(1);
};

export const feeStats = (db: DB, studentId: string) => {
  const items = db.fees.filter((f) => f.studentId === studentId);
  const billed = items.reduce((s, f) => s + f.amount, 0);
  const paid = items.reduce((s, f) => s + f.paid, 0);
  return { items, billed, paid, outstanding: billed - paid };
};

/* ================= mark submission workflow ================= */
export const submissionFor = (db: DB, structureId: string) =>
  db.submissions.find((s) => s.structureId === structureId);

export const submissionStatus = (db: DB, structureId: string): "draft" | "submitted" | "approved" | "published" | "returned" =>
  submissionFor(db, structureId)?.status ?? "draft";

/** True once an assessment's marks are published — the only state students/families may see. */
export const isPublished = (db: DB, structureId: string) => submissionStatus(db, structureId) === "published";

/* =========================================================================
   AUTHORIZATION LAYER — pure functions. Every UI decision and every data
   query goes through these, so access control exists underneath the UI.
   ========================================================================= */

export const getUser = (db: DB, id: string | null) => db.users.find((u) => u.id === id) ?? null;

/** Teacher → class/section pairs they teach (from central assignments). */
export const teacherPairs = (db: DB, user: User | null) => {
  if (!user || user.role !== "teacher" || !user.teacherId) return [] as { classId: string; sectionId: string; subjectIds: string[] }[];
  const map = new Map<string, { classId: string; sectionId: string; subjectIds: string[] }>();
  for (const a of db.assignments) {
    if (a.teacherId !== user.teacherId) continue;
    const key = `${a.classId}|${a.sectionId}`;
    if (!map.has(key)) map.set(key, { classId: a.classId, sectionId: a.sectionId, subjectIds: [] });
    map.get(key)!.subjectIds.push(a.subjectId);
  }
  return [...map.values()];
};

export const teacherClassIds = (db: DB, user: User | null) => [...new Set(teacherPairs(db, user).map((p) => p.classId))];

/** Teacher → the exact student ids they may access. */
export const teacherStudentIds = (db: DB, user: User | null): Set<string> => {
  const pairs = teacherPairs(db, user);
  return new Set(
    db.students
      .filter((s) => s.enrollment && pairs.some((p) => p.classId === s.enrollment!.classId && p.sectionId === s.enrollment!.sectionId))
      .map((s) => s.id)
  );
};

/** Student → their record. */
export const studentOf = (db: DB, user: User | null) =>
  user && user.role === "student" && user.studentId ? db.students.find((s) => s.id === user.studentId) ?? null : null;

/** Guardian → their children's records. */
export const childrenOf = (db: DB, user: User | null): Student[] =>
  user && user.role === "guardian" ? db.students.filter((s) => (user.childrenIds ?? []).includes(s.id)) : [];

/** Student → their linked guardian account (if any). */
export const guardianOfStudent = (db: DB, studentId: string) =>
  db.users.find((u) => u.role === "guardian" && (u.childrenIds ?? []).includes(studentId)) ?? null;

/** Teachers of a student's current class-section. */
export const teachersOfStudent = (db: DB, student: Student) => {
  if (!student.enrollment) return [];
  const seen = new Map<string, { teacherId: string; subjectIds: string[] }>();
  for (const a of db.assignments) {
    if (a.yearId !== student.enrollment.yearId || a.classId !== student.enrollment.classId || a.sectionId !== student.enrollment.sectionId) continue;
    if (!seen.has(a.teacherId)) seen.set(a.teacherId, { teacherId: a.teacherId, subjectIds: [] });
    seen.get(a.teacherId)!.subjectIds.push(a.subjectId);
  }
  return [...seen.values()].map((v) => ({ teacher: getTeacher(db, v.teacherId)!, subjectIds: v.subjectIds }));
};

/** ENTITY-LEVEL CHECK: may this user open this student's record? */
export const canSeeStudent = (db: DB, user: User | null, studentId: string): boolean => {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "teacher") return teacherStudentIds(db, user).has(studentId);
  if (user.role === "student") return user.studentId === studentId;
  if (user.role === "guardian") return (user.childrenIds ?? []).includes(studentId);
  return false;
};

/* -------- communication: audiences resolved through relationships -------- */
export const audienceContainsUser = (db: DB, user: User | null, aud: Audience): boolean => {
  if (!user) return false;
  switch (aud.kind) {
    case "everyone":
      return true;
    case "teachers":
      return user.role === "teacher" || user.role === "admin";
    case "students":
      return user.role === "student";
    case "guardians":
      return user.role === "guardian";
    case "section-students": {
      if (user.role !== "student" || !user.studentId) return user.role === "admin";
      const s = db.students.find((x) => x.id === user.studentId);
      return !!s?.enrollment && s.enrollment.classId === aud.classId && s.enrollment.sectionId === aud.sectionId;
    }
    case "section-guardians": {
      if (user.role !== "guardian") return user.role === "admin";
      return childrenOf(db, user).some(
        (c) => c.enrollment?.classId === aud.classId && c.enrollment?.sectionId === aud.sectionId
      );
    }
  }
};

export const audienceLabel = (db: DB, aud: Audience) => {
  switch (aud.kind) {
    case "everyone": return "Everyone";
    case "teachers": return "All teachers";
    case "students": return "All students";
    case "guardians": return "All guardians";
    case "section-students": return `${sectionShort(db, aud.classId, aud.sectionId)} — students`;
    case "section-guardians": return `${sectionShort(db, aud.classId, aud.sectionId)} — guardians`;
  }
};

export const audienceSize = (db: DB, aud: Audience): number => {
  switch (aud.kind) {
    case "everyone": return db.users.filter((u) => u.status === "active").length;
    case "teachers": return db.users.filter((u) => u.role === "teacher" && u.status === "active").length;
    case "students": return db.users.filter((u) => u.role === "student" && u.status === "active").length;
    case "guardians": return db.users.filter((u) => u.role === "guardian" && u.status === "active").length;
    case "section-students": return studentsOf(db, aud.classId, aud.sectionId).length;
    case "section-guardians":
      return new Set(studentsOf(db, aud.classId, aud.sectionId).flatMap((s) => db.users.filter((u) => u.role === "guardian" && (u.childrenIds ?? []).includes(s.id)).map((u) => u.id))).size;
  }
};

/** Where each role lands after signing in. */
export const homePathFor = (role: Role) => `/${role}/dashboard`;

/* ================= provider ================= */
export interface Toast {
  id: number;
  msg: string;
  tone: "ok" | "warn";
}

interface Ctx {
  db: DB;
  /** Applies fn to a draft, commits it, and (in live mode) syncs to Supabase.
   *  Returns the sync errors, if any — empty in local mode or when everything
   *  landed. Most callers can ignore the return value; callers doing
   *  something the person must know actually persisted (e.g. creating a
   *  login) should await it and check. */
  update: (fn: (d: DB) => void) => Promise<string[]>;
  resetData: () => void;
  yearId: string;
  setYear: (id: string) => void;
  sessionUserId: string | null;
  currentUser: User | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string; user?: User }>;
  logout: () => void;
  toast: (msg: string, tone?: "ok" | "warn") => void;
  ui: { toast: Toast | null };
  dismissToast: () => void;
  ready: boolean;
  /** live = real Supabase data · local = in-memory seed · off = client unconfigured */
  mode: DbMode;
  /** True when the project is reachable but the migrations haven't been applied yet. */
  schemaMissing: boolean;
  /** Re-probe the database and re-hydrate (after migrations are applied). */
  reconnect: () => Promise<DbMode | "missing">;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(() => buildSeed());
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<DbMode>("off");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [yearId, setYearId] = useState("");
  const [toastState, setToastState] = useState<Toast | null>(null);
  const dbRef = useRef(db);

  /* Boot: hydrate from Supabase (RLS-filtered), then restore the Auth session. */
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { db: loaded, mode: m, schemaMissing: missing } = await hydrate();
      if (!mounted) return;
      dbRef.current = loaded;
      setDb(loaded);
      setMode(m);
      setSchemaMissing(missing);
      setYearId(loaded.years.find((y) => y.active)?.id ?? loaded.years[0]?.id ?? "");
      if (m === "live" && isSupabaseConfigured && supabase) {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id ?? null;
        if (uid) { setSessionUserId(uid); setProfileId(uid); }
        supabase.auth.onAuthStateChange((_evt, session) => {
          const id = session?.user?.id ?? null;
          setSessionUserId(id);
          setProfileId(id);
        });
      }
      setReady(true);
    })();
    return () => { mounted = false; };
  }, []);

  /** Re-probe and re-hydrate — used by the setup console after migrations land. */
  const reconnect = async (): Promise<DbMode | "missing"> => {
    const { db: loaded, mode: m, schemaMissing: missing } = await hydrate();
    dbRef.current = loaded;
    setDb(loaded);
    setMode(m);
    setSchemaMissing(missing);
    setYearId(loaded.years.find((y) => y.active)?.id ?? loaded.years[0]?.id ?? "");
    if (m !== "live") { setSessionUserId(null); setProfileId(null); }
    return missing ? "missing" : m;
  };

  const currentUser = useMemo(() => {
    const u = getUser(db, sessionUserId);
    if (!u || u.status !== "active") return null;
    return u;
  }, [db, sessionUserId]);

  // Session points at a profile RLS didn't include in the hydrated set → pull it in.
  useEffect(() => {
    if (!ready || !sessionUserId || getUser(db, sessionUserId)) return;
    let cancelled = false;
    loadProfileForSession(sessionUserId).then((p) => {
      if (cancelled || !p) return;
      update((d) => { d.users = [...d.users.filter((u) => u.id !== p.id), p]; });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sessionUserId, db]);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const update = (fn: (d: DB) => void): Promise<string[]> => {
    const prev = dbRef.current;
    const draft = structuredClone(prev);
    fn(draft);
    dbRef.current = draft;
    setDb(draft);
    if (modeRef.current === "live") return sync(prev, draft); // PostgreSQL; RLS decides what lands
    return Promise.resolve([]);
  };

  const login = async (username: string, password: string): Promise<{ ok: boolean; error?: string; user?: User }> => {
    /* Local demo mode (schema not yet applied / offline): authenticate against the
       in-memory seed so the product stays fully usable while the DB is provisioned. */
    if (mode !== "live" || !supabase) {
      const u = db.users.find((x) => x.username.toLowerCase() === username.trim().toLowerCase());
      if (!u) return { ok: false, error: "No account found with that username." };
      if (u.password !== password) return { ok: false, error: "Incorrect password. Try again." };
      if (u.status !== "active") return { ok: false, error: "This account has been disabled. Contact the administrator." };
      setSessionUserId(u.id);
      return { ok: true, user: u };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error || !data.user) return { ok: false, error: error?.message === "Invalid login credentials" ? "Incorrect username or password." : error?.message ?? "Sign-in failed." };
    const id = data.user.id;
    setSessionUserId(id);
    setProfileId(id);
    const profile = await loadProfileForSession(id);
    if (profile) {
      if (profile.status !== "active") { await supabase.auth.signOut(); setSessionUserId(null); setProfileId(null); return { ok: false, error: "This account has been disabled. Contact the administrator." }; }
      update((d) => { d.users = [...d.users.filter((u) => u.id !== profile.id), profile]; });
      return { ok: true, user: profile };
    }
    return { ok: true };
  };

  const logout = () => {
    supabase?.auth.signOut();
    setSessionUserId(null);
    setProfileId(null);
  };

  const toast = (msg: string, tone: "ok" | "warn" = "ok") => setToastState({ id: Date.now(), msg, tone });
  const dismissToast = () => setToastState(null);

  const resetData = () => {
    if (mode !== "live") {
      const fresh = buildSeed();
      dbRef.current = fresh;
      setDb(fresh);
      setYearId(fresh.years.find((y) => y.active)?.id ?? fresh.years[0].id);
      toast("Demo data has been reset.");
      return;
    }
    toast("Data now lives in Supabase — use the SQL editor or bootstrap script to reseed.", "warn");
  };

  const value = {
    db, update, resetData,
    yearId, setYear: setYearId,
    sessionUserId, currentUser, login, logout,
    toast, ui: { toast: toastState }, dismissToast,
    ready, mode, schemaMissing, reconnect,
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="anim-rise text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-[3px] border-pine-200 border-t-pine-700" />
          <p className="font-display text-[15px] font-bold text-ink">Riverside SMS</p>
          <p className="mt-1 text-[12px] text-soft">{isSupabaseConfigured ? "Connecting to Supabase…" : "Starting in offline demo mode…"}</p>
        </div>
      </div>
    );
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
