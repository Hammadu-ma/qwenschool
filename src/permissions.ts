/**
 * Dependency-free permission catalog + default role permission sets.
 * Kept separate from rbac.ts so the seed can build roles without importing
 * the store (which would create a module cycle).
 */

export interface PermissionDef {
  id: string;
  name: string;
  description: string;
  category: string;
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  { id: "students.view", name: "View students", description: "Browse the student register.", category: "Students" },
  { id: "students.view_assigned", name: "View assigned students", description: "See only students in classes/sections this user teaches.", category: "Students" },
  { id: "students.view_self", name: "View own record", description: "See one's own student profile.", category: "Students" },
  { id: "students.view_children", name: "View children", description: "See only registered children.", category: "Students" },
  { id: "students.create", name: "Register students", description: "Create new student records.", category: "Students" },
  { id: "students.edit", name: "Edit students", description: "Modify student records.", category: "Students" },
  { id: "students.delete", name: "Delete students", description: "Remove student records.", category: "Students" },

  { id: "teachers.view", name: "View teachers", description: "Browse the teaching staff.", category: "Staff" },
  { id: "teachers.manage", name: "Manage teachers", description: "Add, edit and assign teachers.", category: "Staff" },

  { id: "academics.view", name: "View academics", description: "See classes, timetable and syllabus.", category: "Academics" },
  { id: "academics.manage", name: "Manage academics", description: "Edit classes, sections and assignments.", category: "Academics" },
  { id: "homework.manage", name: "Manage homework", description: "Set and grade homework.", category: "Academics" },
  { id: "homework.view", name: "View homework", description: "See assigned homework.", category: "Academics" },
  { id: "assignments.view", name: "View assignments", description: "See teacher–subject assignments.", category: "Academics" },

  { id: "exams.view", name: "View exams", description: "See examinations and components.", category: "Exams & Marks" },
  { id: "exams.manage", name: "Manage exams", description: "Create and schedule examinations.", category: "Exams & Marks" },
  { id: "exams.enter_marks", name: "Enter marks", description: "Record marks for assigned subjects.", category: "Exams & Marks" },

  { id: "results.view", name: "View results", description: "Browse results for accessible students.", category: "Results" },
  { id: "results.view_self", name: "View own results", description: "See one's own results.", category: "Results" },
  { id: "results.view_children", name: "View children's results", description: "See results of registered children.", category: "Results" },
  { id: "results.manage", name: "Manage results", description: "Review and approve results.", category: "Results" },
  { id: "results.publish", name: "Publish results", description: "Release results to students and families.", category: "Results" },

  { id: "attendance.view", name: "View attendance", description: "See attendance registers.", category: "Attendance" },
  { id: "attendance.view_children", name: "View children's attendance", description: "See attendance of registered children.", category: "Attendance" },
  { id: "attendance.manage", name: "Take attendance", description: "Record attendance registers.", category: "Attendance" },

  { id: "fees.view", name: "View fees", description: "See fee ledgers.", category: "Fees" },
  { id: "fees.manage", name: "Manage fees", description: "Record payments and adjust fees.", category: "Fees" },

  { id: "communication.view", name: "View communication", description: "Read announcements, messages and notifications.", category: "Communication" },
  { id: "communication.send", name: "Send messages", description: "Send one-to-one messages (still relationship-checked).", category: "Communication" },
  { id: "communication.create_announcement", name: "Create announcements", description: "Compose announcements for permitted audiences.", category: "Communication" },
  { id: "communication.manage_announcement", name: "Manage announcements", description: "Edit, publish or archive any announcement.", category: "Communication" },
  { id: "communication.moderate", name: "Moderate communication", description: "Review reported messages and conversations.", category: "Communication" },
  { id: "communication.delete", name: "Delete communication", description: "Remove announcements or conversations.", category: "Communication" },
  { id: "communication.school_wide", name: "School-wide announcements", description: "Address the entire school.", category: "Communication" },
  { id: "communication.message_teacher", name: "Message teachers", description: "Open conversations with teachers.", category: "Communication" },
  { id: "communication.message_student", name: "Message students", description: "Open conversations with students.", category: "Communication" },
  { id: "communication.message_parent", name: "Message families", description: "Open conversations with parents/guardians.", category: "Communication" },
  { id: "communication.message_admin", name: "Message administration", description: "Open conversations with the school office.", category: "Communication" },

  { id: "events.view", name: "View events", description: "See the school calendar.", category: "Events" },
  { id: "events.manage", name: "Manage events", description: "Create and edit calendar events.", category: "Events" },

  { id: "users.manage", name: "Manage users", description: "Create accounts and assign roles.", category: "System" },
  { id: "roles.manage", name: "Manage roles & permissions", description: "Create roles and change permission sets.", category: "System" },
  { id: "audit.view", name: "View audit log", description: "Read the security/activity audit trail.", category: "System" },
  { id: "settings.manage", name: "Manage settings", description: "Change school settings.", category: "System" },
];

export const PERMISSION_CATEGORIES = [...new Set(PERMISSION_CATALOG.map((p) => p.category))];

export const permDef = (id: string) => PERMISSION_CATALOG.find((p) => p.id === id);

export const ALL_PERMISSION_IDS = PERMISSION_CATALOG.map((p) => p.id);

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  superadmin: ["*"],
  admin: ALL_PERMISSION_IDS.filter((p) => p !== "roles.manage"),
  coordinator: [
    "students.view", "students.view_assigned", "students.edit",
    "teachers.view",
    "academics.view", "academics.manage", "assignments.view",
    "exams.view", "exams.manage", "exams.enter_marks",
    "results.view", "results.manage", "results.publish",
    "attendance.view", "attendance.manage",
    "communication.view", "communication.send", "communication.create_announcement",
    "communication.message_teacher", "communication.message_student", "communication.message_parent", "communication.message_admin",
    "events.view", "events.manage",
  ],
  teacher: [
    "students.view_assigned", "teachers.view",
    "academics.view", "homework.manage", "homework.view", "assignments.view",
    "exams.view", "exams.enter_marks",
    "results.view",
    "attendance.view", "attendance.manage",
    "communication.view", "communication.send",
    "communication.message_student", "communication.message_parent", "communication.message_admin",
    "events.view",
  ],
  student: [
    "students.view_self",
    "academics.view", "homework.view", "assignments.view",
    "exams.view", "results.view_self", "attendance.view",
    "communication.view", "communication.send",
    "communication.message_teacher", "communication.message_admin",
    "events.view",
  ],
  guardian: [
    "students.view_children",
    "academics.view", "homework.view", "assignments.view",
    "results.view_children", "attendance.view_children",
    "communication.view", "communication.send",
    "communication.message_teacher", "communication.message_admin",
    "events.view",
  ],
};
