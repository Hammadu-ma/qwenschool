export type ID = string;

/* ================= authentication & authorization ================= */
export type Role = "admin" | "teacher" | "student" | "guardian";
export type UserStatus = "active" | "disabled";

export interface User {
  id: ID;
  name: string;
  username: string;
  /** Demo credential. A real deployment would store a salted hash server-side. */
  password: string;
  role: Role;
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

export interface Notice {
  id: ID;
  title: string;
  body: string;
  category: NoticeCategory;
  audience: Audience;
  author: string;
  authorRole: Role;
  at: string;
  pinned: boolean;
}

export interface ThreadMessage {
  id: ID;
  fromName: string;
  fromRole: Role;
  body: string;
  at: string;
}

export interface CommThread {
  id: ID;
  subject: string;
  to: Audience;
  messages: ThreadMessage[];
  read: boolean;
  /** user id of the thread author — drives the "Sent" folder */
  createdBy?: ID;
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
  notices: Notice[];
  threads: CommThread[];
  settings: Settings;
}
