import { type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Compass } from "lucide-react";
import { AppProvider, homePathFor, useApp } from "./store";
import type { Role } from "./types";
import { AppShell } from "./Layout";
import { AccessDenied, LoginPage } from "./pages/Auth";
import { AdminDashboard, GuardianDashboard, StudentDashboard, TeacherDashboard } from "./pages/dashboards";
import {
  FamiliesPage, ProfilePage, StudentProfilePage, StudentsPage, TeachersPage, UsersPage,
} from "./pages/people";
import {
  AssignmentsPage, AttendancePage, ClassesPage, FeesPage, MarkEntryPage, ReportsPage, TimetablePage,
} from "./pages/academics";
import {
  AnnouncementsPage, ContactsPage, EventsPage, MessagesPage, ModerationPage, NotificationsPage,
} from "./pages/communication";
import { AuditPage, RolesPage } from "./pages/admin";

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
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeRedirect />} />

          <Route element={<AppShell />}>
            {/* shared across all authenticated roles — communication (relationship-checked inside) */}
            <Route path="/announcements" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><AnnouncementsPage /></Guard>} />
            <Route path="/messages" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><MessagesPage /></Guard>} />
            <Route path="/messages/:id" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><MessagesPage /></Guard>} />
            <Route path="/notifications" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><NotificationsPage /></Guard>} />
            <Route path="/events" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><EventsPage /></Guard>} />
            <Route path="/contacts" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><ContactsPage /></Guard>} />
            <Route path="/moderation" element={<Guard roles={["admin"]} required="Moderator"><ModerationPage /></Guard>} />
            <Route path="/profile" element={<Guard roles={["admin", "teacher", "student", "guardian"]} required="Any signed-in user"><ProfilePage /></Guard>} />

            {/* system administration — permission-checked inside as well */}
            <Route path="/admin/roles" element={<Guard roles={["admin"]} required="Super Admin"><RolesPage /></Guard>} />
            <Route path="/admin/audit" element={<Guard roles={["admin"]} required="Administrator"><AuditPage /></Guard>} />

            {/* administrator */}
            <Route path="/admin/dashboard" element={<Guard roles={["admin"]} required="Administrator"><AdminDashboard /></Guard>} />
            <Route path="/admin/students" element={<Guard roles={["admin"]} required="Administrator"><StudentsPage /></Guard>} />
            <Route path="/admin/students/:id" element={<Guard roles={["admin"]} required="Administrator"><StudentProfilePage /></Guard>} />
            <Route path="/admin/teachers" element={<Guard roles={["admin"]} required="Administrator"><TeachersPage /></Guard>} />
            <Route path="/admin/families" element={<Guard roles={["admin"]} required="Administrator"><FamiliesPage /></Guard>} />
            <Route path="/admin/classes" element={<Guard roles={["admin"]} required="Administrator"><ClassesPage /></Guard>} />
            <Route path="/admin/timetable" element={<Guard roles={["admin"]} required="Administrator"><TimetablePage /></Guard>} />
            <Route path="/admin/marks" element={<Guard roles={["admin"]} required="Administrator"><MarkEntryPage /></Guard>} />
            <Route path="/admin/assignments" element={<Guard roles={["admin"]} required="Administrator"><AssignmentsPage /></Guard>} />
            <Route path="/admin/reports" element={<Guard roles={["admin"]} required="Administrator"><ReportsPage /></Guard>} />
            <Route path="/admin/attendance" element={<Guard roles={["admin"]} required="Administrator"><AttendancePage /></Guard>} />
            <Route path="/admin/fees" element={<Guard roles={["admin"]} required="Administrator"><FeesPage /></Guard>} />
            <Route path="/admin/users" element={<Guard roles={["admin"]} required="Administrator"><UsersPage /></Guard>} />

            {/* teacher — scoped to assigned classes/students inside each page */}
            <Route path="/teacher/dashboard" element={<Guard roles={["teacher"]} required="Teacher"><TeacherDashboard /></Guard>} />
            <Route path="/teacher/classes" element={<Guard roles={["teacher"]} required="Teacher"><ClassesPage scoped /></Guard>} />
            <Route path="/teacher/students" element={<Guard roles={["teacher"]} required="Teacher"><StudentsPage scoped /></Guard>} />
            <Route path="/teacher/students/:id" element={<Guard roles={["teacher"]} required="Teacher"><StudentProfilePage /></Guard>} />
            <Route path="/teacher/attendance" element={<Guard roles={["teacher"]} required="Teacher"><AttendancePage /></Guard>} />
            <Route path="/teacher/marks" element={<Guard roles={["teacher"]} required="Teacher"><MarkEntryPage /></Guard>} />
            <Route path="/teacher/assignments" element={<Guard roles={["teacher"]} required="Teacher"><AssignmentsPage /></Guard>} />

            {/* student — own records only */}
            <Route path="/student/dashboard" element={<Guard roles={["student"]} required="Student"><StudentDashboard /></Guard>} />
            <Route path="/student/classes" element={<Guard roles={["student"]} required="Student"><ClassesPage scoped /></Guard>} />
            <Route path="/student/grades" element={<Guard roles={["student"]} required="Student"><ReportsPage /></Guard>} />
            <Route path="/student/attendance" element={<Guard roles={["student"]} required="Student"><AttendancePage /></Guard>} />
            <Route path="/student/assignments" element={<Guard roles={["student"]} required="Student"><AssignmentsPage /></Guard>} />

            {/* guardian — registered children only */}
            <Route path="/guardian/dashboard" element={<Guard roles={["guardian"]} required="Guardian"><GuardianDashboard /></Guard>} />
            <Route path="/guardian/children" element={<Guard roles={["guardian"]} required="Guardian"><StudentsPage scoped /></Guard>} />
            <Route path="/guardian/children/:id" element={<Guard roles={["guardian"]} required="Guardian"><StudentProfilePage /></Guard>} />
            <Route path="/guardian/grades" element={<Guard roles={["guardian"]} required="Guardian"><ReportsPage /></Guard>} />
            <Route path="/guardian/attendance" element={<Guard roles={["guardian"]} required="Guardian"><AttendancePage /></Guard>} />
            <Route path="/guardian/assignments" element={<Guard roles={["guardian"]} required="Guardian"><AssignmentsPage /></Guard>} />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
