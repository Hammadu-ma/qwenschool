import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAcademicYear } from "./yearContext";

/**
 * The data layer that replaces "load the whole school into a JavaScript
 * object and filter it with .filter()".
 *
 * Every hook here has three properties the old model could not have:
 *
 *   BOUNDED     — a request returns a page, never a table. The response size
 *                 is set by the page size, not by how many students the
 *                 school has or how many years it has been running.
 *   YEAR-SCOPED — the selected academic year is part of every query key and
 *                 every server call, so cached pages from one year can never
 *                 be shown under another.
 *   ROLE-SCOPED — the server decides the boundary (0024_paged_queries.sql).
 *                 A teacher's request for "students" returns their sections;
 *                 the same call from a guardian returns their children. The
 *                 client does not filter for security and cannot widen it.
 *
 * Caching strategy: reference data is effectively permanent, lists are
 * short-lived, and a single record sits in between. Mutations invalidate by
 * prefix rather than refetching everything.
 */

/* ========================================================================
   Query keys — one place, so invalidation can never drift from fetching.
   ======================================================================== */

export const qk = {
  bootstrap: (year: string) => ["bootstrap", year] as const,
  reference: (year: string) => ["reference", year] as const,
  students: (year: string, f: StudentFilters) => ["students", year, f] as const,
  student: (year: string, id: string) => ["student", year, id] as const,
  marksheet: (year: string, structureId: string) => ["marksheet", year, structureId] as const,
  register: (year: string, c: string, s: string, day: string) =>
    ["register", year, c, s, day] as const,
  attendanceSummary: (year: string, c?: string, s?: string) =>
    ["attendance-summary", year, c ?? "*", s ?? "*"] as const,
  fees: (year: string, f: FeeFilters) => ["fees", year, f] as const,
  conversations: (year: string) => ["conversations", year] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  notifications: (unreadOnly: boolean) => ["notifications", unreadOnly] as const,
  audit: (year: string) => ["audit", year] as const,
};

const STALE = {
  /** Classes, subjects, grading scale — changes about twice a year. */
  reference: 60 * 60 * 1000,
  /** Who I am and what I may do — for the session. */
  session: 30 * 60 * 1000,
  /** Lists people edit: stale quickly enough to feel live. */
  list: 30 * 1000,
  /** A single record being viewed. */
  record: 60 * 1000,
  /** Chat: always refetch on mount. */
  realtime: 0,
};

/** Calls a PostgREST RPC and throws on error so React Query can handle it. */
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/* ========================================================================
   Bootstrap — one request, role-shaped, year-scoped.
   Replaces get_app_bootstrap()'s full-database dump.
   ======================================================================== */

export interface Scope {
  profileId: string;
  role: "admin" | "teacher" | "student" | "guardian";
  roleDefId: string;
  yearId: string;
  permissions: string[];
  teacherId?: string;
  studentId?: string;
  childIds?: string[];
  assignments?: { classId: string; sectionId: string; subjectId: string }[];
  children?: { studentId: string; classId: string; sectionId: string; rollNumber: number }[];
}

export interface Bootstrap {
  yearId: string;
  scope: Scope;
  reference: {
    school: Record<string, unknown> | null;
    years: unknown[];
    terms: unknown[];
    classes: { id: string; name: string; level: number }[];
    sections: { id: string; class_id: string; name: string }[];
    subjects: { id: string; name: string; code: string; color: string | null }[];
    grading: { min_pct: number; max_pct: number; grade: string; remark: string }[];
    roleDefs: unknown[];
  };
  profile: Record<string, unknown> | null;
  unread: number;
  summary?: Record<string, number>;
  timetable?: unknown[];
  structures?: unknown[];
  fees?: unknown[];
  children?: unknown[];
}

export function useBootstrap() {
  const { yearId } = useAcademicYear();
  return useQuery({
    queryKey: qk.bootstrap(yearId ?? ""),
    enabled: Boolean(supabase && yearId),
    staleTime: STALE.session,
    queryFn: () => rpc<Bootstrap>("get_bootstrap", { p_year_id: yearId }),
  });
}

/** The caller's permission set, for gating UI. Authorization still happens
 *  on the server — this only decides what is worth rendering. */
export function usePermissions(): Set<string> {
  const { data } = useBootstrap();
  return new Set(data?.scope?.permissions ?? []);
}

/* ========================================================================
   Students — paged and searched on the server.

   The old people.tsx filtered an in-memory array on every keystroke. At
   5,000 students that is 5,000 string comparisons per character typed, on
   the UI thread. Here the browser sends the search term and receives 50
   rows; the trigram index in 0022 does the matching.
   ======================================================================== */

export interface StudentFilters {
  classId?: string;
  sectionId?: string;
  status?: string;
  search?: string;
  sort?: "name" | "roll" | "reg";
  page?: number;
  pageSize?: number;
}

export interface StudentRow {
  student_id: string;
  reg_no: string;
  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string;
  dob: string;
  photo_path: string | null;
  status: string;
  class_id: string;
  section_id: string;
  roll_number: number | null;
  guardian_phone: string | null;
  total_count: number;
}

export function useStudents(filters: StudentFilters = {}) {
  const { yearId } = useAcademicYear();
  const pageSize = filters.pageSize ?? 50;
  const page = filters.page ?? 0;

  const query = useQuery({
    queryKey: qk.students(yearId ?? "", { ...filters, page, pageSize }),
    enabled: Boolean(supabase && yearId),
    staleTime: STALE.list,
    // Keeps the previous page on screen while the next one loads, so paging
    // and typing don't flash an empty table.
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<StudentRow[]>("list_students", {
        p_year_id: yearId,
        p_class_id: filters.classId ?? null,
        p_section_id: filters.sectionId ?? null,
        p_status: filters.status ?? "active",
        p_search: filters.search?.trim() || null,
        p_sort: filters.sort ?? "name",
        p_limit: pageSize,
        p_offset: page * pageSize,
      }),
  });

  const rows = query.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  return {
    ...query,
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function useStudentDetail(studentId: string | null) {
  const { yearId } = useAcademicYear();
  return useQuery({
    queryKey: qk.student(yearId ?? "", studentId ?? ""),
    enabled: Boolean(supabase && yearId && studentId),
    staleTime: STALE.record,
    queryFn: () =>
      rpc<Record<string, unknown>>("get_student_detail", {
        p_student_id: studentId,
        p_year_id: yearId,
      }),
  });
}

/* ========================================================================
   Marks and attendance — the two tables that grow fastest.
   ======================================================================== */

export function useMarksheet(structureId: string | null) {
  const { yearId } = useAcademicYear();
  return useQuery({
    queryKey: qk.marksheet(yearId ?? "", structureId ?? ""),
    enabled: Boolean(supabase && structureId),
    staleTime: STALE.record,
    queryFn: () => rpc<Record<string, unknown>>("get_marksheet", { p_structure_id: structureId }),
  });
}

export function useRegister(classId: string | null, sectionId: string | null, day: string) {
  const { yearId } = useAcademicYear();
  return useQuery({
    queryKey: qk.register(yearId ?? "", classId ?? "", sectionId ?? "", day),
    enabled: Boolean(supabase && yearId && classId && sectionId && day),
    staleTime: STALE.list,
    queryFn: () =>
      rpc<Record<string, unknown>>("get_register", {
        p_year_id: yearId,
        p_class_id: classId,
        p_section_id: sectionId,
        p_day: day,
      }),
  });
}

export interface AttendanceSummaryRow {
  student_id: string;
  full_name: string;
  roll_number: number | null;
  present: number;
  absent: number;
  late: number;
  total: number;
  pct: number;
}

export function useAttendanceSummary(classId?: string, sectionId?: string, from?: string, to?: string) {
  const { yearId } = useAcademicYear();
  return useQuery({
    queryKey: [...qk.attendanceSummary(yearId ?? "", classId, sectionId), from ?? "*", to ?? "*"],
    enabled: Boolean(supabase && yearId),
    staleTime: STALE.list,
    queryFn: () =>
      rpc<AttendanceSummaryRow[]>("get_attendance_summary", {
        p_year_id: yearId,
        p_class_id: classId ?? null,
        p_section_id: sectionId ?? null,
        p_from: from ?? null,
        p_to: to ?? null,
      }),
  });
}

/* ========================================================================
   Fees
   ======================================================================== */

export interface FeeFilters {
  classId?: string;
  sectionId?: string;
  onlyOutstanding?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface FeeRow {
  fee_id: string;
  student_id: string;
  full_name: string;
  class_id: string | null;
  section_id: string | null;
  label: string;
  amount: number;
  paid: number;
  due_date: string | null;
  term_id: string | null;
  total_count: number;
  total_billed: number;
  total_paid: number;
}

export function useFees(filters: FeeFilters = {}) {
  const { yearId } = useAcademicYear();
  const pageSize = filters.pageSize ?? 50;
  const page = filters.page ?? 0;

  const query = useQuery({
    queryKey: qk.fees(yearId ?? "", { ...filters, page, pageSize }),
    enabled: Boolean(supabase && yearId),
    staleTime: STALE.list,
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<FeeRow[]>("list_fees", {
        p_year_id: yearId,
        p_class_id: filters.classId ?? null,
        p_section_id: filters.sectionId ?? null,
        p_only_outstanding: filters.onlyOutstanding ?? false,
        p_search: filters.search?.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      }),
  });

  const rows = query.data ?? [];
  return {
    ...query,
    rows,
    total: rows[0]?.total_count ?? 0,
    billed: rows[0]?.total_billed ?? 0,
    collected: rows[0]?.total_paid ?? 0,
    page,
    pageSize,
  };
}

/* ========================================================================
   Messaging — keyset pagination.

   OFFSET-based paging gets slower the further back you scroll, because the
   database still has to walk the rows it is skipping. "Everything before
   this timestamp" is an index seek no matter how deep the thread goes, so
   scrolling back through two years of messages costs the same as loading
   the first screen.
   ======================================================================== */

export function useConversations() {
  const { yearId } = useAcademicYear();
  return useQuery({
    queryKey: qk.conversations(yearId ?? ""),
    enabled: Boolean(supabase && yearId),
    staleTime: STALE.realtime,
    queryFn: () => rpc<unknown[]>("list_conversations", { p_year_id: yearId, p_limit: 30 }),
  });
}

export interface MessageRow {
  id: string;
  sender_id: string;
  body: string;
  read_by: string[];
  created_at: string;
}

export function useMessages(conversationId: string | null, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: qk.messages(conversationId ?? ""),
    enabled: Boolean(supabase && conversationId),
    staleTime: STALE.realtime,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<MessageRow[]>("list_messages", {
        p_conversation_id: conversationId,
        p_before: pageParam,
        p_limit: pageSize,
      }),
    // The cursor is the oldest message we have; a short page means we've
    // reached the start of the thread.
    getNextPageParam: (last) =>
      last.length < pageSize ? undefined : last[last.length - 1]?.created_at ?? undefined,
  });
}

export function useNotifications(unreadOnly = false, pageSize = 30) {
  return useInfiniteQuery({
    queryKey: qk.notifications(unreadOnly),
    enabled: Boolean(supabase),
    staleTime: STALE.realtime,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ id: string; created_at: string }[]>("list_notifications", {
        p_before: pageParam,
        p_limit: pageSize,
        p_unread_only: unreadOnly,
      }),
    getNextPageParam: (last) =>
      last.length < pageSize ? undefined : last[last.length - 1]?.created_at ?? undefined,
  });
}

export function useAuditLog(pageSize = 50) {
  const { yearId } = useAcademicYear();
  return useInfiniteQuery({
    queryKey: qk.audit(yearId ?? ""),
    enabled: Boolean(supabase && yearId),
    staleTime: STALE.list,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      rpc<{ id: string; at: string }[]>("list_audit", {
        p_year_id: yearId,
        p_before: pageParam,
        p_limit: pageSize,
      }),
    getNextPageParam: (last) =>
      last.length < pageSize ? undefined : last[last.length - 1]?.at ?? undefined,
  });
}

/* ========================================================================
   Year lifecycle mutations (0025_year_lifecycle.sql).
   ======================================================================== */

export function useYearAdmin() {
  const qc = useQueryClient();
  const invalidateEverything = () => qc.invalidateQueries();

  return {
    createYear: useMutation({
      mutationFn: (v: { id: string; name: string; start: string; end: string; terms?: string[] }) =>
        rpc("create_academic_year", {
          p_id: v.id,
          p_name: v.name,
          p_start: v.start,
          p_end: v.end,
          p_terms: v.terms ?? ["Term 1", "Term 2", "Term 3"],
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["academic-years"] }),
    }),

    setActiveYear: useMutation({
      mutationFn: (yearId: string) => rpc("set_active_year", { p_year_id: yearId }),
      onSuccess: invalidateEverything,
    }),

    closeYear: useMutation({
      mutationFn: (yearId: string) => rpc("close_year", { p_year_id: yearId }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["academic-years"] }),
    }),

    /** Copy a year's structure (assignments, timetable, grading, assessment
     *  shapes, fee templates) into a new year. Records are never copied. */
    rollover: useMutation({
      mutationFn: (v: { from: string; to: string }) =>
        rpc<Record<string, number>>("rollover_year", { p_from_year: v.from, p_to_year: v.to }),
      onSuccess: invalidateEverything,
    }),

    /** Move every active enrollment up one class level in one statement. */
    promote: useMutation({
      mutationFn: (v: { from: string; to: string; classId?: string; graduateTop?: boolean }) =>
        rpc<{ promoted: number; graduated: number }>("promote_students", {
          p_from_year: v.from,
          p_to_year: v.to,
          p_class_id: v.classId ?? null,
          p_graduate_top: v.graduateTop ?? true,
        }),
      onSuccess: invalidateEverything,
    }),

    /** Bill an entire class from one template. */
    applyFeeTemplate: useMutation({
      mutationFn: (templateId: string) => rpc("apply_fee_template", { p_template_id: templateId }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["fees"] }),
    }),
  };
}

/* ========================================================================
   Prefetching — the cheapest speed win available.

   Fires the request while the user is still deciding to click, so the page
   is already in cache by the time it mounts. Call from onMouseEnter on a
   row, or on a nav link.
   ======================================================================== */

export function usePrefetch() {
  const qc = useQueryClient();
  const { yearId } = useAcademicYear();

  return {
    student: (id: string) =>
      qc.prefetchQuery({
        queryKey: qk.student(yearId ?? "", id),
        queryFn: () => rpc("get_student_detail", { p_student_id: id, p_year_id: yearId }),
        staleTime: STALE.record,
      }),
    marksheet: (structureId: string) =>
      qc.prefetchQuery({
        queryKey: qk.marksheet(yearId ?? "", structureId),
        queryFn: () => rpc("get_marksheet", { p_structure_id: structureId }),
        staleTime: STALE.record,
      }),
  };
}
