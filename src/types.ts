export type ID = string;

/* ================= authentication & authorization ================= */
export type Role = "admin" | "teacher" | "student" | "guardian";
export type UserStatus = "active" | "disabled";

/**
 * A role is a named collection of permissions. `permissions` holds permission
 * ids from the central catalog (or "*" for full access). System roles are
 * protected from deletion; their permission sets remain editable by a
 * super-admin so the school can tune them.
 */
export interface RoleDef {
  id: ID;
  name: string;
  description: string;
  permissions: string[];
  status: "active" | "disabled";
  /** System roles can't be removed; only their permissions may change. */
  system: boolean;
  /** Which base roles this profile may be assigned to. */
  appliesTo: Role[];
}

export interface User {
  id: ID;
  name: string;
  username: string;
  /** Demo credential. A real deployment would store a salted hash server-side. */
  password: string;
  /**
   * Base role — the entity type that drives RELATIONSHIPS (who this person is
   * connected to: teacher→assignments, student→enrollment, guardian→children).
   */
  role: Role;
  /**
   * Permission profile — drives Level-1 role PERMISSIONS (what actions this
   * account may perform). Points at a RoleDef in db.roles.
   */
  roleId: ID;
  status: UserStatus;
  email?: string;
  phone?: string;
  /** teacher → linked Teacher record (class access flows from assignments) */
  teacherId?: ID;
  /** student → linked Student record */
  studentId?: ID;
  /** guardian → linked child Student record ids */
  childrenIds?: ID[];
  createdAt: string;
}

/* ================= academic structure ================= */
export interface AcademicYear {
  id: ID;
  name: string;
  start: string;
  end: string;
  active: boolean;
}

export interface Section {
  id: ID;
  name: string;
}

export interface SchoolClass {
  id: ID;
  name: string;
  level: number;
  sections: Section[];
}

export interface Subject {
  id: ID;
  name: string;
  code: string;
  color: string;
}

export interface Teacher {
  id: ID;
  name: string;
  phone?: string;
  email?: string;
  specialty?: string;
}

/** Central teacher–subject assignment: the single source of truth for who teaches what where. */
export interface Assignment {
  id: ID;
  yearId: ID;
  classId: ID;
  sectionId: ID;
  subjectId: ID;
  teacherId: ID;
}

export interface Enrollment {
  yearId: ID;
  classId: ID;
  sectionId: ID;
}

export interface StudentDoc {
  id: ID;
  name: string;
  kind: string;
  size: string;
  date: string;
}

export interface Student {
  id: ID;
  regId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: "Male" | "Female";
  dob: string;
  phone?: string;
  email?: string;
  address?: string;
  guardian: {
    father: string;
    mother?: string;
    relation: string;
    phone?: string;
    address?: string;
  };
  admission: {
    number: string;
    date: string;
    previousSchool?: string;
    type: string;
  };
  enrollment?: Enrollment;
  /** Append-only academic history — one entry per year, never overwritten. */
  history: Enrollment[];
  documents: StudentDoc[];
}

export interface TimetableEntry {
  id: ID;
  classId: ID;
  sectionId: ID;
  day: number; // 0 = Monday
  period: number;
  subjectId: ID;
  room: string;
}

export interface Homework {
  id: ID;
  yearId: ID;
  classId: ID;
  sectionId: ID;
  subjectId: ID;
  title: string;
  description?: string;
  issued: string;
  due: string;
  submitted: ID[];
}

export interface AssessmentItem {
  id: ID;
  name: string;
  max: number;
  weight: number;
}

export interface AssessmentStructure {
  id: ID;
  yearId: ID;
  classId: ID;
  subjectId: ID;
  period: string;
  items: AssessmentItem[];
}

export interface GradeBand {
  min: number;
  max: number;
  grade: string;
  remark: string;
}

export type AttendanceStatus = "present" | "absent" | "late";

export interface AttendanceRecord {
  date: string;
  classId: ID;
  sectionId: ID;
  marks: Record<ID, AttendanceStatus>;
}

export interface FeeItem {
  id: ID;
  studentId: ID;
  label: string;
  amount: number;
  paid: number;
  due: string;
}

/* ================= communication ================= */
export type NoticeCategory = "Urgent" | "Academic" | "Exams" | "Event" | "General";

/** Audience reuses the same placement model the rest of the system is built on. */
export type Audience =
  | { kind: "everyone" }
  | { kind: "teachers" }
  | { kind: "students" }
  | { kind: "guardians" }
  | { kind: "section-students"; classId: ID; sectionId: ID }
  | { kind: "section-guardians"; classId: ID; sectionId: ID };

export type AnnouncementStatus = "draft" | "scheduled" | "published" | "archived";

/** One-to-many official communication. References entities by id — never duplicates them. */
export interface Announcement {
  id: ID;
  title: string;
  body: string;
  category: NoticeCategory;
  senderId: ID;
  audience: Audience;
  status: AnnouncementStatus;
  createdAt: string;
  scheduledFor?: string; // ISO datetime; becomes published once reached
  publishedAt?: string;
  editedAt?: string;
  pinned?: boolean;
  /** user ids that have opened/read the announcement (read tracking) */
  readBy?: ID[];
}

/** One-to-one (or small group) conversation, anchored to school context. */
export type ConversationStatus = "active" | "archived" | "hidden";

export interface Conversation {
  id: ID;
  type: "direct";
  participants: ID[]; // user ids
  relatedStudentId?: ID;
  relatedClassId?: ID;
  relatedSectionId?: ID;
  relatedSubjectId?: ID;
  createdAt: string;
  updatedAt: string;
  status: ConversationStatus;
}

export type MessageStatus = "sent" | "read";

export interface Message {
  id: ID;
  conversationId: ID;
  senderId: ID;
  body: string;
  createdAt: string;
  readBy: ID[];
  status: MessageStatus;
}

export type ReportStatus = "open" | "resolved" | "dismissed";

export interface MessageReport {
  id: ID;
  messageId: ID;
  conversationId: ID;
  reporterId: ID;
  reason: string;
  detail?: string;
  at: string;
  status: ReportStatus;
}

/** System-generated notification. */
export interface AppNotification {
  id: ID;
  userId: ID;
  type: "announcement" | "message" | "homework" | "result" | "attendance" | "event" | "system";
  title: string;
  body: string;
  at: string;
  read: boolean;
}

/** School calendar event, optionally audience-targeted. */
export interface SchoolEvent {
  id: ID;
  title: string;
  description?: string;
  date: string; // yyyy-mm-dd
  time?: string;
  location?: string;
  category: NoticeCategory;
  audience: Audience;
  createdBy: ID;
}

/** Security/activity audit entry. */
export interface AuditEntry {
  id: ID;
  userId: ID;
  userName: string;
  action: string;
  target: string;
  detail?: string;
  at: string;
}

export interface Settings {
  schoolName: string;
  motto: string;
}

export interface DB {
  users: User[];
  years: AcademicYear[];
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: Teacher[];
  assignments: Assignment[];
  students: Student[];
  timetable: TimetableEntry[];
  homework: Homework[];
  structures: AssessmentStructure[];
  /** assessmentMarks[structureId][studentId][itemId] = raw mark */
  assessmentMarks: Record<string, Record<string, Record<string, number>>>;
  grading: GradeBand[];
  attendance: AttendanceRecord[];
  fees: FeeItem[];
  roles: RoleDef[];
  announcements: Announcement[];
  conversations: Conversation[];
  messages: Message[];
  reports: MessageReport[];
  notifications: AppNotification[];
  events: SchoolEvent[];
  audit: AuditEntry[];
  settings: Settings;
}
