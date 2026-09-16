import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import { AppProvider, homePathFor, useApp } from "./store";
import type { Role } from "./types";
import { AppShell } from "./Layout";
import { AccessDenied, LoginPage } from "./pages/Auth";
import { ChunkErrorBoundary, clearChunkReloadGuard } from "./lib/ChunkErrorBoundary";

/* =========================================================================
   Route-level code splitting. Each pages/*.tsx module becomes its own chunk
   (Rollup dedupes all dynamic imports of the same module specifier into one
   chunk, so re-listing several named exports per file below still yields
   exactly one chunk per file — not one per component). A guardian's bundle
   never has to download admin.tsx's code, and so on for every role.

   Auth.tsx (LoginPage/AccessDenied) and Layout.tsx (AppShell) stay eager —
   they're needed for the very first screen regardless of role, so lazily
   splitting them would only add a Suspense flash with no payload savings.
   ========================================================================= */
const AdminDashboard = lazy(() => import("./pages/dashboards").then((m) => ({ default: m.AdminDashboard })));
const TeacherDashboard = lazy(() => import("./pages/dashboards").then((m) => ({ default: m.TeacherDashboard })));
const StudentDashboard = lazy(() => import("./pages/dashboards").then((m) => ({ default: m.StudentDashboard })));
const GuardianDashboard = lazy(() => import("./pages/dashboards").then((m) => ({ default: m.GuardianDashboard })));

const FamiliesPage = lazy(() => import("./pages/people").then((m) => ({ default: m.FamiliesPage })));
const ProfilePage = lazy(() => import("./pages/people").then((m) => ({ default: m.ProfilePage })));
const StudentProfilePage = lazy(() => import("./pages/people").then((m) => ({ default: m.StudentProfilePage })));
const StudentsPage = lazy(() => import("./pages/people").then((m) => ({ default: m.StudentsPage })));
const TeachersPage = lazy(() => import("./pages/people").then((m) => ({ default: m.TeachersPage })));
const UsersPage = lazy(() => import("./pages/people").then((m) => ({ default: m.UsersPage })));

const AssignmentsPage = lazy(() => import("./pages/academics").then((m) => ({ default: m.AssignmentsPage })));
const AttendancePage = lazy(() => import("./pages/academics").then((m) => ({ default: m.AttendancePage })));
const AcademicYearsPage = lazy(() => import("./pages/academics").then((m) => ({ default: m.AcademicYearsPage })));
const ClassesPage = lazy(() => import("./pages/academics").then((m) => ({ default: m.ClassesPage })));
const FeesPage = lazy(() => import("./pages/academics").then((m) => ({ default: m.FeesPage })));
const HomeworkPage = lazy(() => import("./pages/academics").then((m) => ({ default: m.HomeworkPage })));
const MarkEntryPage = lazy(() => import("./pages/academics").then((m) => ({ default: m.MarkEntryPage })));
const ReportsPage = lazy(() => import("./pages/academics").then((m) => ({ default: m.ReportsPage })));
const TimetablePage = lazy(() => import("./pages/academics").then((m) => ({ default: m.TimetablePage })));

const AnnouncementsPage = lazy(() => import("./pages/communication").then((m) => ({ default: m.AnnouncementsPage })));
const ContactsPage = lazy(() => import("./pages/communication").then((m) => ({ default: m.ContactsPage })));
const EventsPage = lazy(() => import("./pages/communication").then((m) => ({ default: m.EventsPage })));
const MessagesPage = lazy(() => import("./pages/communication").then((m) => ({ default: m.MessagesPage })));
const ModerationPage = lazy(() => import("./pages/communication").then((m) => ({ default: m.ModerationPage })));
const NotificationsPage = lazy(() => import("./pages/communication").then((m) => ({ default: m.NotificationsPage })));

const AuditPage = lazy(() => import("./pages/admin").then((m) => ({ default: m.AuditPage })));
const RolesPage = lazy(() => import("./pages/admin").then((m) => ({ default: m.RolesPage })));

/** Shown inside AppShell (sidebar/topbar already painted) while a route
 *  chunk downloads. Deliberately lighter than the store.tsx boot spinner —
 *  the chrome is already up, only the page body is missing. */
function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-pine-200 border-t-pine-700" />
    </div>
  );
}

/** One boundary + fallback pair per lazy route, keyed to the current path so
 *  a failure on one page doesn't linger once the person navigates away. */
function LazyRoute({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ChunkErrorBoundary resetKey={pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}

// Successfully rendering anything at all means the current chunk set is
// good — clear the one-time reload guard so a *future* stale-chunk error
// (after the next deploy) is still allowed to trigger one reload.
function ChunkReloadGuardReset() {
  useEffect(() => { clearChunkReloadGuard(); }, []);
  return null;
}

/** Route-level authorization: checks the signed-in role, blocks everything else. */
function Guard({ roles, required, children }: { roles: Role[]; required?: string; children: ReactNode }) {
  const { currentUser } = useApp();
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!roles.includes(currentUser.role)) {
    return <AccessDenied required={required ?? roles.map((r) => r[0].toUpperCase() + r.slice(1)).join(" / ")} />;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  const { currentUser } = useApp();
  if (!currentUser) return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(currentUser.role)} replace />;
}

function NotFound() {
  const { currentUser } = useApp();
  return (
    <AccessDenied
      required="A valid route"
      reason={
        currentUser
          ? "That address doesn't exist in the system. If you followed a link, it may have pointed to a section your role can't reach."
          : "Sign in to reach the school management system."
      }
    />
  );
}

export default function App() {
  return (
    <AppProvider>
      <ChunkReloadGuardReset />
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeRedirect />} />

          <Route element={<AppShell />}>
            {/* shared across all authenticated roles — communication (relationship-checked inside) */}
            <Route path="/announcements" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><LazyRoute><AnnouncementsPage /></LazyRoute></Guard>} />
            <Route path="/messages" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><LazyRoute><MessagesPage /></LazyRoute></Guard>} />
            <Route path="/messages/:id" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><LazyRoute><MessagesPage /></LazyRoute></Guard>} />
            <Route path="/notifications" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><LazyRoute><NotificationsPage /></LazyRoute></Guard>} />
            <Route path="/events" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><LazyRoute><EventsPage /></LazyRoute></Guard>} />
            <Route path="/contacts" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><LazyRoute><ContactsPage /></LazyRoute></Guard>} />
            <Route path="/moderation" element={<Guard roles={["admin"]} required="Moderator"><LazyRoute><ModerationPage /></LazyRoute></Guard>} />
            <Route path="/profile" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><LazyRoute><ProfilePage /></LazyRoute></Guard>} />

            {/* system administration — permission-checked inside as well */}
            <Route path="/admin/roles" element={<Guard roles={["admin"]} required="Super Admin"><LazyRoute><RolesPage /></LazyRoute></Guard>} />
            <Route path="/admin/audit" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><AuditPage /></LazyRoute></Guard>} />

            {/* administrator */}
            <Route path="/admin/dashboard" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><AdminDashboard /></LazyRoute></Guard>} />
            <Route path="/admin/students" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><StudentsPage /></LazyRoute></Guard>} />
            <Route path="/admin/students/:id" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><StudentProfilePage /></LazyRoute></Guard>} />
            <Route path="/admin/teachers" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><TeachersPage /></LazyRoute></Guard>} />
            <Route path="/admin/families" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><FamiliesPage /></LazyRoute></Guard>} />
            <Route path="/admin/classes" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><ClassesPage /></LazyRoute></Guard>} />
            <Route path="/admin/academic-years" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><AcademicYearsPage /></LazyRoute></Guard>} />
            <Route path="/admin/timetable" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><TimetablePage /></LazyRoute></Guard>} />
            <Route path="/admin/marks" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><MarkEntryPage /></LazyRoute></Guard>} />
            <Route path="/admin/assignments" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><AssignmentsPage /></LazyRoute></Guard>} />
            <Route path="/admin/homework" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><HomeworkPage /></LazyRoute></Guard>} />
            <Route path="/admin/reports" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><ReportsPage /></LazyRoute></Guard>} />
            <Route path="/admin/attendance" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><AttendancePage /></LazyRoute></Guard>} />
            <Route path="/admin/fees" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><FeesPage /></LazyRoute></Guard>} />
            <Route path="/admin/users" element={<Guard roles={["admin"]} required="Administrator"><LazyRoute><UsersPage /></LazyRoute></Guard>} />

            {/* teacher — scoped to assigned classes/students inside each page */}
            <Route path="/teacher/dashboard" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><TeacherDashboard /></LazyRoute></Guard>} />
            <Route path="/teacher/classes" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><ClassesPage scoped /></LazyRoute></Guard>} />
            <Route path="/teacher/students" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><StudentsPage scoped /></LazyRoute></Guard>} />
            <Route path="/teacher/students/:id" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><StudentProfilePage /></LazyRoute></Guard>} />
            <Route path="/teacher/attendance" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><AttendancePage /></LazyRoute></Guard>} />
            <Route path="/teacher/marks" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><MarkEntryPage /></LazyRoute></Guard>} />
            <Route path="/teacher/assignments" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><AssignmentsPage /></LazyRoute></Guard>} />
            <Route path="/teacher/homework" element={<Guard roles={["teacher"]} required="Teacher"><LazyRoute><HomeworkPage /></LazyRoute></Guard>} />

            {/* student — own records only */}
            <Route path="/student/dashboard" element={<Guard roles={["student"]} required="Student"><LazyRoute><StudentDashboard /></LazyRoute></Guard>} />
            <Route path="/student/classes" element={<Guard roles={["student"]} required="Student"><LazyRoute><ClassesPage scoped /></LazyRoute></Guard>} />
            <Route path="/student/grades" element={<Guard roles={["student"]} required="Student"><LazyRoute><ReportsPage /></LazyRoute></Guard>} />
            <Route path="/student/attendance" element={<Guard roles={["student"]} required="Student"><LazyRoute><AttendancePage /></LazyRoute></Guard>} />
            <Route path="/student/assignments" element={<Guard roles={["student"]} required="Student"><LazyRoute><AssignmentsPage /></LazyRoute></Guard>} />
            <Route path="/student/homework" element={<Guard roles={["student"]} required="Student"><LazyRoute><HomeworkPage /></LazyRoute></Guard>} />

            {/* guardian — registered children only */}
            <Route path="/guardian/dashboard" element={<Guard roles={["guardian"]} required="Guardian"><LazyRoute><GuardianDashboard /></LazyRoute></Guard>} />
            <Route path="/guardian/children" element={<Guard roles={["guardian"]} required="Guardian"><LazyRoute><StudentsPage scoped /></LazyRoute></Guard>} />
            <Route path="/guardian/children/:id" element={<Guard roles={["guardian"]} required="Guardian"><LazyRoute><StudentProfilePage /></LazyRoute></Guard>} />
            <Route path="/guardian/grades" element={<Guard roles={["guardian"]} required="Guardian"><LazyRoute><ReportsPage /></LazyRoute></Guard>} />
            <Route path="/guardian/attendance" element={<Guard roles={["guardian"]} required="Guardian"><LazyRoute><AttendancePage /></LazyRoute></Guard>} />
            <Route path="/guardian/assignments" element={<Guard roles={["guardian"]} required="Guardian"><LazyRoute><AssignmentsPage /></LazyRoute></Guard>} />
            <Route path="/guardian/homework" element={<Guard roles={["guardian"]} required="Guardian"><LazyRoute><HomeworkPage /></LazyRoute></Guard>} />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
