import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AssessmentStructure, Audience, DB, Role, Student, User,
} from "./types";
import { buildSeed } from "./data/seed";
import { supabase, isSupabaseConfigured, usernameToEmail } from "./lib/supabase";
import {
  hydrate, hydrateCore, hydrateGroup, ALL_LAZY_GROUPS, sync, setProfileId, loadProfileForSession,
  mapConversations, mapMessages, dbCache,
  type DbMode, type LazyGroup,
} from "./lib/backend";

export const uid = () => crypto.randomUUID();

/** Turns update()'s raw sync-error list into one clear sentence. Login-account
 *  failures (tagged "login for X: …" in backend.ts) are common and recoverable
 *  — the record itself still saved — so they're worded differently from a
 *  failure to save the record itself. Account-deletion failures (tagged
 *  "delete for X: …") get their own wording too, since — unlike every other
 *  sync error — nothing was actually saved: the account is still live on the
 *  server and the caller should reconnect to undo the optimistic local removal
 *  rather than believe the "deleted" state it's showing. */
export function describeSyncErrors(errors: string[]): string {
  if (!errors.length) return "";
  const deleteErr = errors.find((e) => e.startsWith("delete for "));
  if (deleteErr) return deleteErr.replace(/^delete for [^:]+: /, "");
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

/** The most recent still-pending bank-transfer request against a fee item, if any. */
export const pendingRequestFor = (db: DB, feeItemId: string) =>
  db.paymentRequests.find((r) => r.feeItemId === feeItemId && r.status === "pending");

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
  reconnect: () => Promise<DbMode | "missing" | "error">;
  sessionChecked: boolean;
  /** True once this feature's tables have been fetched this session (or the
   *  app isn't in live mode, where everything is already in memory). Pages
   *  can use this to show a loading state instead of trusting an empty
   *  array as "no records". */
  isGroupLoaded: (group: LazyGroup) => boolean;
  /** Fetches one feature's tables on demand, once per session, the first
   *  time a page that needs them mounts. Safe to call every render — it's a
   *  no-op once loaded or while already in flight. */
  ensureGroup: (group: LazyGroup) => void;
  /** Ids of users with a live Supabase Realtime presence in this session —
   *  i.e. currently have the app open. Used for Telegram-style "online"
   *  indicators in Messages. Empty outside live mode. */
  onlineUserIds: Set<string>;
}

const AppCtx = createContext<Ctx | null>(null);

/** Which DB fields each lazy group owns — mirrors the switch in
 *  hydrateGroup() (backend.ts) and the fields it zeroes out on every core
 *  hydrate. Used by mergeFreshCore() below. */
const GROUP_FIELDS: Record<LazyGroup, (keyof DB)[]> = {
  academics: ["structures", "assessmentMarks", "submissions", "grading"],
  attendance: ["attendance"],
  fees: ["fees", "paymentRequests"],
  homework: ["homework"],
  timetable: ["timetable"],
  announcements: ["announcements"],
  messaging: ["conversations", "messages"],
  notifications: ["notifications"],
  events: ["events"],
  audit: ["audit"],
  reports: ["reports"],
};

/**
 * hydrateCore() always comes back with every lazy-group field forced empty
 * (see backend.ts) — it has no way to know which groups this tab has
 * already fetched. Blindly `setDb(core)`-ing that over the live db used to
 * wipe out any group a page had already loaded (via ensureGroup, straight
 * off the wire or instant-painted from its own cache) the moment the core
 * hydrate landed — a visible "data shows, then disappears a beat later" on
 * every refresh of a page like Attendance/Fees/Messages. This restores the
 * already-loaded groups' fields from the current db before the fresh core
 * replaces everything else, so a group only ever goes empty because
 * hydrateGroup() itself said so, never as a side-effect of the core
 * refresh racing past it.
 */
function mergeFreshCore(core: DB, current: DB, loaded: Set<LazyGroup>): DB {
  const merged: DB = { ...core };
  for (const group of loaded) {
    for (const field of GROUP_FIELDS[group]) {
      (merged as any)[field] = (current as any)[field];
    }
  }
  return merged;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(() => buildSeed());
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<DbMode>("off");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  // Mirrors sessionUserId for the background hydrateCore() kicked off by
  // login() below — that promise resolves after login() has already
  // returned, so it needs a way to check "is this still the active session"
  // that isn't a stale closure over the sessionUserId state at call time.
  const sessionUserIdRef = useRef<string | null>(null);
  // False until the initial supabase.auth.getSession() call resolves. Routes
  // that redirect-to-login on "no currentUser" must wait for this instead of
  // reading a not-yet-checked session as "signed out".
  const [sessionChecked, setSessionChecked] = useState(false);
  const [yearId, setYearId] = useState("");
  const [toastState, setToastState] = useState<Toast | null>(null);
  const dbRef = useRef(db);
  const applySessionUserId = (id: string | null) => { sessionUserIdRef.current = id; setSessionUserId(id); };
  // Which feature groups this session has actually fetched — tracked with
  // both a ref (so ensureGroup can check synchronously and never double-fire
  // for two components that mount in the same tick) and state (so isGroupLoaded
  // reads trigger a re-render once a fetch lands).
  const loadedGroupsRef = useRef<Set<LazyGroup>>(new Set());
  const loadingGroupsRef = useRef<Set<LazyGroup>>(new Set());
  const [loadedGroupsTick, setLoadedGroupsTick] = useState(0);

  /* Boot: every load re-confirms against Supabase — never a fake seed
   * standing in as if it were real data. The one exception is dbCache
   * (see backend.ts): a per-tab, per-user instant-repaint of the last
   * confirmed snapshot, painted while this same hydrateCore() call is
   * still in flight underneath it and overwritten the moment it resolves.
   * Without any cached snapshot, the spinner stays up until hydrateCore()
   * actually resolves against the live database, exactly as before. */
  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Set inside the session-check branch below and read again once
    // hydrateCore() resolves, so a retry pass (isRetry=true, which skips
    // that branch) still knows who to write the refreshed cache back for.
    let uidForCache: string | null = null;

    const attempt = async (isRetry: boolean) => {
      if (!isRetry && isSupabaseConfigured && supabase) {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id ?? null;
        uidForCache = uid;
        if (uid) {
          applySessionUserId(uid); setProfileId(uid);

          // Instant paint: if this exact user already has a confirmed
          // snapshot from earlier in this tab, show it right away instead
          // of a blank spinner. hydrateCore() below still runs regardless
          // and overwrites this the moment it lands — usually well under a
          // second later — so this never risks the person acting on data
          // that doesn't get reconciled.
          const cached = dbCache.readCache<DB>(dbCache.cacheKey(uid, "core"));
          if (cached && Array.isArray(cached.students) && Array.isArray(cached.years)) {
            dbRef.current = cached;
            setDb(cached);
            setMode("live");
            setYearId(cached.years.find((y) => y.active)?.id ?? cached.years[0]?.id ?? "");
            setReady(true);
          }
        }
        supabase.auth.onAuthStateChange((_evt, session) => {
          const id = session?.user?.id ?? null;
          applySessionUserId(id);
          setProfileId(id);
        });
      }
      if (!isRetry) setSessionChecked(true);

      // hydrateCore() only pulls the small reference data (school structure,
      // people, permissions) — a dozen tables instead of all 33 — so first
      // paint no longer waits on messages/attendance/fees/marks/etc. Those
      // load lazily via ensureGroup() the moment a page that needs them
      // mounts.
      const { db: core, mode: m, schemaMissing: missing, transientError } = await hydrateCore();
      if (!mounted) return;

      if (transientError) {
        // The probe itself failed (network blip, timeout) — this is NOT
        // "schema missing" or "not configured". If we're already live this
        // session, leave mode/db exactly as they are (don't kick the person
        // to a fake local-demo state) and quietly retry once shortly after.
        if (modeRef.current === "live") {
          if (!isRetry) retryTimer = setTimeout(() => { attempt(true); }, 4000);
          return;
        }
        setMode("off");
        setSchemaMissing(false);
        setReady(true);
        return;
      }

      const mergedCore = mergeFreshCore(core, dbRef.current, loadedGroupsRef.current);
      dbRef.current = mergedCore;
      setDb(mergedCore);
      setMode(m);
      setSchemaMissing(missing);
      setYearId(mergedCore.years.find((y) => y.active)?.id ?? mergedCore.years[0]?.id ?? "");
      setReady(true);
      if (m === "live" && uidForCache) dbCache.writeCache(dbCache.cacheKey(uidForCache, "core"), core);
    };

    attempt(false);
    return () => { mounted = false; if (retryTimer) clearTimeout(retryTimer); };
  }, []);

  /** Re-probe and re-hydrate — used by the setup console after migrations land. */
  const reconnect = async (): Promise<DbMode | "missing" | "error"> => {
    loadedGroupsRef.current = new Set();
    loadingGroupsRef.current = new Set();
    const { db: loaded, mode: m, schemaMissing: missing, transientError } = await hydrateCore();
    if (transientError) return "error"; // leave current state untouched — nothing was actually confirmed
    dbRef.current = loaded;
    setDb(loaded);
    setMode(m);
    setSchemaMissing(missing);
    setYearId(loaded.years.find((y) => y.active)?.id ?? loaded.years[0]?.id ?? "");
    if (m !== "live") { applySessionUserId(null); setProfileId(null); }
    return missing ? "missing" : m;
  };

  /** True once `group`'s tables have been fetched this session — always
   *  true outside live mode, since local/off already hold everything in
   *  memory. Depends on loadedGroupsTick so components re-render once a
   *  fetch this hook kicked off actually lands. */
  const isGroupLoaded = (group: LazyGroup): boolean => {
    void loadedGroupsTick;
    return modeRef.current !== "live" || loadedGroupsRef.current.has(group);
  };

  /** Fetches one feature group's tables on demand. No-op outside live mode
   *  (already fully in memory) and no-op once loaded or already in flight,
   *  so it's safe for every page to call unconditionally on mount. */
  const ensureGroup = (group: LazyGroup) => {
    if (modeRef.current !== "live") return;
    if (loadedGroupsRef.current.has(group) || loadingGroupsRef.current.has(group)) return;
    loadingGroupsRef.current.add(group);

    // Same instant-paint trick as the core boot cache: if this group was
    // already fetched for this exact user earlier in this tab, show it
    // immediately while the real fetch below confirms/reconciles it.
    if (sessionUserId) {
      const cached = dbCache.readCache<Partial<DB>>(dbCache.cacheKey(sessionUserId, group));
      if (cached) {
        dbRef.current = { ...dbRef.current, ...cached };
        setDb(dbRef.current);
      }
    }

    hydrateGroup(group, dbRef.current)
      .then((partial) => {
        const merged: DB = { ...dbRef.current, ...partial };
        dbRef.current = merged;
        setDb(merged);
        if (sessionUserId) dbCache.writeCache(dbCache.cacheKey(sessionUserId, group), partial);
      })
      .catch((e) => console.warn(`[store] failed to load ${group}:`, e))
      .finally(() => {
        loadingGroupsRef.current.delete(group);
        loadedGroupsRef.current.add(group);
        setLoadedGroupsTick((t) => t + 1);
      });
  };

  const currentUser = useMemo(() => {
    const u = getUser(db, sessionUserId);
    if (!u || u.status !== "active") return null;
    return u;
  }, [db, sessionUserId]);

  /* ================= realtime: messages, conversations, presence =================
   * Keeps Messages Telegram-like: a new message from the other side appears
   * the instant it's written (no refetch), a read receipt flips the
   * sender's ticks live, a brand-new conversation someone starts with me
   * shows up in the inbox on its own, and an "online" dot reflects who
   * currently has the app open. RLS still decides what each connected
   * session actually receives — see 0013_enable_realtime_messaging.sql. */
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (mode !== "live" || !supabase || !sessionUserId) {
      setOnlineUserIds(new Set());
      return;
    }
    const client = supabase;
    const channel = client.channel("school-realtime", { config: { presence: { key: sessionUserId } } });

    const mergeMessage = (row: any, isUpdate: boolean) => {
      const msg = mapMessages([row])[0];
      const cur = dbRef.current;
      if (!cur.conversations.some((c) => c.id === msg.conversationId)) return; // not (yet) a conversation of mine
      const exists = cur.messages.some((m) => m.id === msg.id);
      if (!isUpdate && exists) return; // our own optimistic send already added it
      if (isUpdate && !exists) return;
      const next: DB = { ...cur, messages: exists ? cur.messages.map((m) => (m.id === msg.id ? msg : m)) : [...cur.messages, msg] };
      dbRef.current = next;
      setDb(next);
    };

    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineUserIds(new Set(Object.keys(channel.presenceState())));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => mergeMessage(payload.new, false))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => mergeMessage(payload.new, true))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_participants", filter: `profile_id=eq.${sessionUserId}` },
        async (payload) => {
          const conversationId = (payload.new as any).conversation_id as string;
          if (dbRef.current.conversations.some((c) => c.id === conversationId)) return;
          const [{ data: convRow }, { data: partRows }] = await Promise.all([
            client.from("conversations").select("*").eq("id", conversationId).maybeSingle(),
            client.from("conversation_participants").select("*").eq("conversation_id", conversationId),
          ]);
          if (!convRow) return;
          const conv = mapConversations([convRow], partRows ?? [])[0];
          const cur = dbRef.current;
          if (cur.conversations.some((c) => c.id === conv.id)) return;
          const next: DB = { ...cur, conversations: [conv, ...cur.conversations] };
          dbRef.current = next;
          setDb(next);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track({ online_at: new Date().toISOString() });
      });

    return () => { client.removeChannel(channel); };
  }, [mode, sessionUserId]);

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
    // No offline/local write path: if Supabase isn't live, refuse rather than
    // mutate in-memory state that would only look saved.
    if (modeRef.current !== "live") return Promise.resolve(["Not connected to Supabase — nothing was saved."]);
    const prev = dbRef.current;
    const draft = structuredClone(prev);
    fn(draft);
    dbRef.current = draft;
    setDb(draft);
    return sync(prev, draft).then(async (errors) => {
      if (errors.length) {
        // The optimistic draft may not match what actually landed on the
        // server — pull the authoritative state back down rather than let
        // the UI keep showing a change that didn't really save. Without
        // this, a failed write (e.g. a rejected new user) leaves a
        // permanent "ghost" record in local state for the rest of the
        // session — one with a placeholder id that was never swapped for
        // a real one — which then breaks unrelated features later (e.g. a
        // notification recipient list built from that ghost user).
        const recovered = await hydrate();
        if (recovered.transientError) {
          // The re-fetch itself failed (network blip) — don't stomp real
          // local state with the fake seed; just report the sync error.
          console.warn("[store] recovery hydrate() failed transiently; keeping current state");
        } else {
          dbRef.current = recovered.db;
          setDb(recovered.db);
          // hydrate() (unlike hydrateCore()) pulls every table, so everything
          // is now genuinely fresh — mark every lazy group loaded rather than
          // let an already-mounted page's ensureGroup() immediately refetch
          // and briefly stomp this recovered state with a slower request.
          loadedGroupsRef.current = new Set(ALL_LAZY_GROUPS);
          setLoadedGroupsTick((t) => t + 1);
        }
      }
      return errors;
    }); // PostgreSQL; RLS decides what lands
  };

  const login = async (username: string, password: string): Promise<{ ok: boolean; error?: string; user?: User }> => {
    // No offline/local auth path: sign-in always goes through Supabase Auth.
    if (mode !== "live" || !supabase) {
      return { ok: false, error: "Not connected to Supabase yet — finish setup above, then try again." };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error || !data.user) return { ok: false, error: error?.message === "Invalid login credentials" ? "Incorrect username or password." : error?.message ?? "Sign-in failed." };
    const id = data.user.id;
    applySessionUserId(id);
    setProfileId(id);

    // Drop every lazy-loaded group so pages that already mounted before this
    // sign-in (or belonged to a previous session) fetch that data fresh
    // under the new account instead of showing stale/wrong-user content.
    loadedGroupsRef.current = new Set();
    loadingGroupsRef.current = new Set();

    // Instant paint from this user's last confirmed snapshot on this device,
    // if any — same pattern as the boot-time instant-paint above — so the
    // dashboard they land on doesn't flash zeroed-out data while the fresh
    // hydrateCore() below is still in flight.
    const cachedCore = dbCache.readCache<DB>(dbCache.cacheKey(id, "core"));
    if (cachedCore && Array.isArray(cachedCore.students) && Array.isArray(cachedCore.years)) {
      dbRef.current = cachedCore;
      setDb(cachedCore);
      setMode("live");
      setYearId(cachedCore.years.find((y) => y.active)?.id ?? cachedCore.years[0]?.id ?? "");
    }

    // Resolving *who* just signed in only needs their own profile row — a
    // single indexed lookup — not the ~14-table (or bootstrap-RPC) core
    // hydrate. Fetching that in full before letting the person past the
    // login button is what was making sign-in feel slow; it now runs in the
    // background below instead, same as any other lazy group, and the
    // dashboard reflows onto it a moment later.
    let profile = getUser(dbRef.current, id) ?? (await loadProfileForSession(id));
    if (profile && profile.status !== "active") {
      await supabase.auth.signOut();
      applySessionUserId(null);
      setProfileId(null);
      return { ok: false, error: "This account has been disabled. Contact the administrator." };
    }
    if (profile && !getUser(dbRef.current, id)) {
      const merged: DB = { ...dbRef.current, users: [...dbRef.current.users.filter((u) => u.id !== profile!.id), profile!] };
      dbRef.current = merged;
      setDb(merged);
    }

    // Full core refresh, in the background — not awaited. Guarded against
    // this no longer being the active session (e.g. a quick logout, or a
    // second sign-in) landing stale data after the fact.
    hydrateCore().then(({ db: fresh, mode: m, schemaMissing: missing, transientError }) => {
      if (transientError || sessionUserIdRef.current !== id) return;
      const mergedFresh = mergeFreshCore(fresh, dbRef.current, loadedGroupsRef.current);
      dbRef.current = mergedFresh;
      setDb(mergedFresh);
      setMode(m);
      setSchemaMissing(missing);
      setYearId(mergedFresh.years.find((y) => y.active)?.id ?? mergedFresh.years[0]?.id ?? "");
      if (m === "live") dbCache.writeCache(dbCache.cacheKey(id, "core"), fresh);
      setLoadedGroupsTick((t) => t + 1);
    });

    return profile ? { ok: true, user: profile } : { ok: true };
  };

  const logout = () => {
    supabase?.auth.signOut();
    if (sessionUserId) dbCache.clearUserCache(sessionUserId);
    applySessionUserId(null);
    setProfileId(null);
    // Wipe in-memory state along with the auth session — otherwise the next
    // sign-in on this tab/device (possibly a different person) would still
    // have the previous session's data sitting in `db` and in the
    // loaded-groups cache until every page happened to re-trigger a fetch.
    const blank = buildSeed();
    dbRef.current = blank;
    setDb(blank);
    loadedGroupsRef.current = new Set();
    loadingGroupsRef.current = new Set();
    setLoadedGroupsTick((t) => t + 1);
  };

  const toast = (msg: string, tone: "ok" | "warn" = "ok") => setToastState({ id: Date.now(), msg, tone });
  const dismissToast = () => setToastState(null);

  const resetData = () => {
    toast("Data lives in Supabase — use the SQL editor or bootstrap script to reseed.", "warn");
  };

  const value = {
    db, update, resetData,
    yearId, setYear: setYearId,
    sessionUserId, currentUser, login, logout,
    toast, ui: { toast: toastState }, dismissToast,
    ready, mode, schemaMissing, reconnect, sessionChecked,
    isGroupLoaded, ensureGroup, onlineUserIds,
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="anim-rise text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-[3px] border-pine-200 border-t-pine-700" />
          <p className="font-display text-[15px] font-bold text-ink">Riverside SMS</p>
          <p className="mt-1 text-[12px] text-soft">{isSupabaseConfigured ? "Connecting to Supabase…" : "Supabase isn't configured — set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."}</p>
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

/** Call at the top of any page that reads one or more lazy-loaded feature
 *  groups (attendance, fees, homework, timetable, academics/marks,
 *  announcements, messaging, notifications, events, audit, reports).
 *  Triggers the fetch on mount (once per session; a no-op afterward) and
 *  returns whether every requested group has landed, so the page can show
 *  a loading state instead of reading an empty array as "no records". */
export function useLazyGroups(groups: LazyGroup | LazyGroup[]): boolean {
  const { isGroupLoaded, ensureGroup } = useApp();
  const list = Array.isArray(groups) ? groups : [groups];
  const key = list.join(",");
  useEffect(() => {
    for (const g of list) ensureGroup(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return list.every((g) => isGroupLoaded(g));
}
