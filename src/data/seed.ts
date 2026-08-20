import type {
  AttendanceRecord,
  AttendanceStatus,
  DB,
  Enrollment,
  Student,
  TimetableEntry,
  User,
} from "../types";
import { DEFAULT_PERMISSIONS } from "../permissions";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
export const PERIODS = [
  { period: 1, time: "08:00" },
  { period: 2, time: "09:00" },
  { period: 3, time: "10:30" },
  { period: 4, time: "11:30" },
  { period: 5, time: "13:30" },
  { period: 6, time: "14:30" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const at = (daysAgo: number, hour = 9, min = 20) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const pad3 = (n: number) => String(n).padStart(3, "0");

type RosterRow = [string, string, string, "Male" | "Female", number];

const ROSTER_8B: RosterRow[] = [
  ["Abebe", "Kebede", "Tesema", "Male", 0.87],
  ["Hana", "Alemu", "Worku", "Female", 0.93],
  ["Ahmed", "Mohammed", "Nuru", "Male", 0.8],
  ["Sara", "Tesfay", "Gebre", "Female", 0.84],
  ["Yohannes", "Girma", "Debebe", "Male", 0.76],
  ["Lulit", "Mengistu", "Assefa", "Female", 0.9],
  ["Bereket", "Tadesse", "Lemma", "Male", 0.71],
  ["Selamawit", "Awate", "Berhe", "Female", 0.79],
  ["Kalkidan", "Fikre", "Haile", "Female", 0.86],
];
const ROSTER_8A: RosterRow[] = [
  ["Dawit", "Solomon", "Ayele", "Male", 0.82],
  ["Mariam", "Haftu", "Kidane", "Female", 0.88],
  ["Natnael", "Zerihun", "Getachew", "Male", 0.74],
  ["Tigist", "Alemayehu", "Sisay", "Female", 0.91],
  ["Robel", "Kassa", "Mulugeta", "Male", 0.69],
  ["Betelhem", "Girma", "Tefera", "Female", 0.85],
  ["Eyob", "Tesfaye", "Aragaw", "Male", 0.78],
  ["Rahel", "Bekele", "Desta", "Female", 0.89],
];
const ROSTER_7A: RosterRow[] = [
  ["Samuel", "Fikadu", "Gudeta", "Male", 0.81],
  ["Hanna", "Demissie", "Belay", "Female", 0.87],
  ["Yonas", "Kebede", "Endale", "Male", 0.75],
  ["Feven", "Haile", "Mariam", "Female", 0.9],
  ["Abel", "Tesfaye", "Wondimu", "Male", 0.72],
  ["Lidya", "Mengistu", "Tafari", "Female", 0.83],
];

const ADDRESSES = [
  "Kebena, Block 4, House 21",
  "Piassa, near Post Office, House 12",
  "Gotera, Condominium B-304",
  "Merkato, Arada sub-city, House 88",
  "Sarbet, House 45",
  "Kazanchis, House 7",
  "Bole, Woreda 03, House 19",
  "Summit, Condominium A-118",
];

export function buildSeed(): DB {
  /* ---------------- users: one credential set, role + permission profile ---------------- */
  const users: User[] = [
    {
      id: "u-root", name: "Dr. Selam Bekele", username: "root", password: "root123",
      role: "admin", roleId: "superadmin", status: "active", email: "selam.bekele@riverside.edu", phone: "0911 000 000",
      createdAt: addDays(-500),
    },
    {
      id: "u-admin", name: "Amara Tesfaye", username: "admin", password: "admin123",
      role: "admin", roleId: "admin", status: "active", email: "admin@riverside.edu", phone: "0911 000 001",
      createdAt: addDays(-400),
    },
    {
      id: "u-coord", name: "Ms. Lydia Fikre", username: "lydia", password: "coord123",
      role: "admin", roleId: "coordinator", status: "active", email: "lydia.fikre@riverside.edu", phone: "0911 000 009",
      createdAt: addDays(-250),
    },
    {
      id: "u-t1", name: "Mr. Ahmed Yusuf", username: "ahmed", password: "teach123",
      role: "teacher", roleId: "teacher", status: "active", email: "ahmed.yusuf@riverside.edu", phone: "0911 234 501",
      teacherId: "t1", createdAt: addDays(-320),
    },
    {
      id: "u-t2", name: "Ms. Hana Girma", username: "hana.g", password: "teach123",
      role: "teacher", roleId: "teacher", status: "active", email: "hana.girma@riverside.edu", phone: "0911 234 502",
      teacherId: "t2", createdAt: addDays(-320),
    },
    {
      id: "u-s1", name: "Abebe Kebede", username: "abebe", password: "stud123",
      role: "student", roleId: "student", status: "active", email: "abebe@student.riverside.edu",
      studentId: "st1", createdAt: addDays(-45),
    },
    {
      id: "u-s2", name: "Hana Alemu", username: "hana.a", password: "stud123",
      role: "student", roleId: "student", status: "active", email: "hana@student.riverside.edu",
      studentId: "st2", createdAt: addDays(-45),
    },
    {
      id: "u-g1", name: "Kebede Tesema", username: "kebede", password: "fam123",
      role: "guardian", roleId: "guardian", status: "active", email: "kebede.t@mail.com", phone: "0911 555 210",
      childrenIds: ["st1", "st2"], createdAt: addDays(-45),
    },
    {
      id: "u-g2", name: "Almaz Worku", username: "almaz", password: "fam123",
      role: "guardian", roleId: "guardian", status: "active", email: "almaz.w@mail.com", phone: "0911 555 342",
      childrenIds: ["st3"], createdAt: addDays(-40),
    },
    {
      id: "u-t3", name: "Mr. Ali Omar", username: "ali", password: "teach123",
      role: "teacher", roleId: "teacher", status: "disabled", email: "ali.omar@riverside.edu",
      teacherId: "t3", createdAt: addDays(-300),
    },
  ];

  /* ---------------- academic years / classes / subjects ---------------- */
  const years: DB["years"] = [
    { id: "y25", name: "2025/26", start: "2025-09-15", end: "2026-07-03", active: false },
    { id: "y26", name: "2026/27", start: "2026-09-14", end: "2027-07-02", active: true },
  ];

  const classes: DB["classes"] = [
    { id: "c7", name: "Grade 7", level: 7, sections: [{ id: "sec7a", name: "A" }, { id: "sec7b", name: "B" }] },
    {
      id: "c8", name: "Grade 8", level: 8,
      sections: [{ id: "sec8a", name: "A" }, { id: "sec8b", name: "B" }, { id: "sec8c", name: "C" }],
    },
  ];

  const subjects: DB["subjects"] = [
    { id: "math", name: "Mathematics", code: "MATH", color: "#2c654c" },
    { id: "bio", name: "Biology", code: "BIO", color: "#557d3b" },
    { id: "eng", name: "English", code: "ENG", color: "#b07e24" },
    { id: "phy", name: "Physics", code: "PHY", color: "#3a6b8c" },
    { id: "hist", name: "History", code: "HIS", color: "#96543f" },
  ];

  const teachers: DB["teachers"] = [
    { id: "t1", name: "Mr. Ahmed Yusuf", phone: "0911 234 501", email: "ahmed.yusuf@riverside.edu", specialty: "Mathematics" },
    { id: "t2", name: "Ms. Hana Girma", phone: "0911 234 502", email: "hana.girma@riverside.edu", specialty: "Biology" },
    { id: "t3", name: "Mr. Ali Omar", phone: "0911 234 503", email: "ali.omar@riverside.edu", specialty: "English" },
    { id: "t4", name: "Mrs. Selam Tesfaye", phone: "0911 234 504", email: "selam.tesfaye@riverside.edu", specialty: "Physics" },
    { id: "t5", name: "Ms. Meron Alemu", phone: "0911 234 506", email: "meron.alemu@riverside.edu", specialty: "History" },
    { id: "t6", name: "Mr. Samuel Tadesse", phone: "0911 234 507", email: "samuel.tadesse@riverside.edu", specialty: "Mathematics" },
  ];

  /* subject → teacher is the central relationship. Grade 8A Mathematics goes to
     Mr. Samuel so that Mr. Ahmed's access is genuinely scoped to his own sections. */
  const subjectTeacher: Record<string, string> = { math: "t1", bio: "t2", eng: "t3", phy: "t4", hist: "t5" };

  const assignments: DB["assignments"] = [];
  let aid = 0;
  for (const [cid, secs] of [
    ["c8", ["sec8a", "sec8b", "sec8c"]],
    ["c7", ["sec7a"]],
  ] as [string, string[]][]) {
    for (const sec of secs) {
      for (const s of subjects) {
        const teacherId = s.id === "math" && cid === "c8" && sec === "sec8a" ? "t6" : subjectTeacher[s.id];
        assignments.push({ id: `as${++aid}`, yearId: "y26", classId: cid, sectionId: sec, subjectId: s.id, teacherId });
      }
    }
  }

  /* ---------------- students ---------------- */
  const students: Student[] = [];
  const ability: Record<string, number> = {};
  let n = 0;
  const mkStudent = (row: RosterRow, classId: string, sectionId: string, grade: 7 | 8, history: Enrollment[]) => {
    n += 1;
    const i = n;
    const [firstName, middleName, lastName, gender, ab] = row;
    const id = `st${i}`;
    const dobYear = grade === 8 ? 2013 : 2014;
    const dob = `${dobYear}-${String(1 + Math.floor(rnd(i, 3) * 11)).padStart(2, "0")}-${String(1 + Math.floor(rnd(i, 4) * 27)).padStart(2, "0")}`;
    const addr = ADDRESSES[i % ADDRESSES.length];
    students.push({
      id,
      regId: `ST-2026-${pad3(i)}`,
      firstName, middleName, lastName, gender, dob,
      phone: `09${String(10000000 + Math.floor(rnd(i, 5) * 89999999)).slice(0, 8)}`,
      email: `${firstName}.${lastName}`.toLowerCase() + "@student.riverside.edu",
      address: addr,
      guardian: {
        father: `${["Kebede", "Alemu", "Mohammed", "Tesfay", "Girma", "Mengistu", "Tadesse", "Solomon"][i % 8]} ${lastName}`,
        mother: `${["Almaz", "Tigist", "Fatuma", "Wudenesh", "Hirut", "Meskerem"][i % 6]} ${lastName}`,
        relation: "Father",
        phone: `09${String(20000000 + Math.floor(rnd(i, 6) * 79999999)).slice(0, 8)}`,
        address: addr,
      },
      admission: {
        number: `ADM-2026-${pad3(i)}`,
        date: addDays(-(45 - (i % 9))),
        previousSchool: ["Hope Primary School", "Bright Future Academy", "Riverside Primary School"][i % 3],
        type: i % 5 === 0 ? "Transfer" : "New Admission",
      },
      enrollment: { yearId: "y26", classId, sectionId },
      history: [...history, { yearId: "y26", classId, sectionId }],
      documents: [
        { id: `${id}d1`, name: "Birth certificate.pdf", kind: "Birth certificate", size: `${120 + (i % 9) * 37} KB`, date: addDays(-(40 - (i % 9))) },
      ],
    });
    ability[id] = ab;
  };

  ROSTER_8B.forEach((row, idx) =>
    mkStudent(row, "c8", "sec8b", 8, [
      { yearId: "y25", classId: "c7", sectionId: idx % 2 === 0 ? "sec7b" : "sec7a" },
    ])
  );
  ROSTER_8A.forEach((row, idx) =>
    mkStudent(row, "c8", "sec8a", 8, [
      { yearId: "y25", classId: "c7", sectionId: idx % 2 === 0 ? "sec7a" : "sec7b" },
    ])
  );
  ROSTER_7A.forEach((row, idx) =>
    mkStudent(row, "c7", "sec7a", 7, [])
  );

  /* ---------------- timetable ---------------- */
  const timetable: TimetableEntry[] = [];
  let tid = 0;
  const subjArr = subjects.map((s) => s.id);
  const fill = (classId: string, sectionId: string, days: number[]) => {
    for (const day of days) {
      for (let p = 0; p < 6; p++) {
        timetable.push({
          id: `tt${++tid}`, classId, sectionId, day, period: p + 1,
          subjectId: subjArr[(day * 3 + p * 2 + (classId === "c8" ? 0 : 1)) % subjects.length],
          room: `R-20${(day + p + (classId === "c8" ? 1 : 4)) % 10}`,
        });
      }
    }
  };
  fill("c8", "sec8b", [0, 1, 2, 3, 4]);
  fill("c8", "sec8a", [0, 2, 4]);
  fill("c7", "sec7a", [1, 3]);

  /* ---------------- homework ---------------- */
  const homework: DB["homework"] = [
    { id: "hw1", yearId: "y26", classId: "c8", sectionId: "sec8b", subjectId: "math", title: "Exercises 1–10, page 24", description: "Solve exercises 1–10 from the textbook. Show all working steps.", issued: addDays(-3), due: addDays(2), submitted: ["st1", "st2", "st3", "st5"] },
    { id: "hw2", yearId: "y26", classId: "c8", sectionId: "sec8b", subjectId: "bio", title: "Lab report — onion cell slide", description: "One-page lab report with a labelled diagram.", issued: addDays(-2), due: addDays(4), submitted: ["st1", "st6"] },
    { id: "hw3", yearId: "y26", classId: "c8", sectionId: "sec8b", subjectId: "eng", title: "Essay: My favourite season", description: "300 words, five adjectives, two similes.", issued: addDays(-6), due: addDays(-1), submitted: ["st1", "st2", "st4", "st7", "st9"] },
    { id: "hw4", yearId: "y26", classId: "c8", sectionId: "sec8a", subjectId: "phy", title: "Speed & velocity — sheet 3", description: "Problems 1–8 with SI units.", issued: addDays(-1), due: addDays(6), submitted: [] },
    { id: "hw5", yearId: "y26", classId: "c7", sectionId: "sec7a", subjectId: "math", title: "Fractions worksheet", description: "Complete the worksheet handed out in class.", issued: addDays(-2), due: addDays(3), submitted: ["st18"] },
  ];

  /* ---------------- assessment structures + marks ---------------- */
  const structures: DB["structures"] = [];
  const addStructure = (key: string, classId: string, subjectId: string, period: string, defs: [string, number, number][]) => {
    structures.push({
      id: `as-${key}`, yearId: "y26", classId, subjectId, period,
      items: defs.map(([name, max, weight], i) => ({ id: `${key}-i${i + 1}`, name, max, weight })),
    });
  };
  addStructure("bio8s1", "c8", "bio", "Semester 1", [
    ["Assessment 1", 20, 20], ["Assessment 2", 20, 20], ["Assessment 3", 20, 20], ["Final Exam", 40, 40],
  ]);
  addStructure("math8s1", "c8", "math", "Semester 1", [
    ["Quiz 1", 10, 10], ["Assignment", 10, 10], ["Midterm", 30, 30], ["Final Exam", 50, 50],
  ]);
  addStructure("eng8s1", "c8", "eng", "Semester 1", [
    ["Listening", 20, 20], ["Assignment", 10, 10], ["Midterm", 30, 30], ["Final Exam", 40, 40],
  ]);
  addStructure("phy8s1", "c8", "phy", "Semester 1", [
    ["Practical", 30, 30], ["Midterm", 30, 30], ["Final Exam", 40, 40],
  ]);
  addStructure("hist8s1", "c8", "hist", "Semester 1", [
    ["Quiz 1", 10, 10], ["Assignment", 10, 10], ["Midterm", 30, 30], ["Final Exam", 50, 50],
  ]);

  const assessmentMarks: DB["assessmentMarks"] = {};
  const genA = (key: string, classId: string, salt: number, skip: string[] = []) => {
    const st = structures.find((x) => x.id === `as-${key}`)!;
    const table: Record<string, Record<string, number>> = {};
    students
      .filter((s) => s.enrollment?.classId === classId)
      .forEach((s, idx) => {
        if (skip.includes(s.id)) return;
        const row: Record<string, number> = {};
        st.items.forEach((it, ci) => {
          const jitter = (rnd(idx + 1, salt + ci * 17) - 0.5) * 0.18;
          row[it.id] = Math.max(Math.round(it.max * 0.3), Math.min(it.max, Math.round(it.max * (ability[s.id] + jitter))));
        });
        table[s.id] = row;
      });
    assessmentMarks[st.id] = table;
  };
  genA("bio8s1", "c8", 71, ["st9"]);
  assessmentMarks["as-bio8s1"]["st1"] = { "bio8s1-i1": 18, "bio8s1-i2": 17, "bio8s1-i3": 19, "bio8s1-i4": 35 };
  assessmentMarks["as-bio8s1"]["st2"] = { "bio8s1-i1": 16, "bio8s1-i2": 18, "bio8s1-i3": 17, "bio8s1-i4": 32 };
  assessmentMarks["as-bio8s1"]["st3"] = { "bio8s1-i1": 12, "bio8s1-i2": 14, "bio8s1-i3": 13, "bio8s1-i4": 25 };
  genA("math8s1", "c8", 83);
  genA("eng8s1", "c8", 97);
  genA("phy8s1", "c8", 103);
  genA("hist8s1", "c8", 131);

  /* ---------------- attendance (past weekdays + today) ---------------- */
  const attendance: AttendanceRecord[] = [];
  const weekdays: string[] = [];
  for (let back = 1; weekdays.length < 12; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) weekdays.push(iso(d));
  }
  weekdays.push(addDays(0));
  const sectionRosters: [string, string][] = [["c7", "sec7a"], ["c8", "sec8a"], ["c8", "sec8b"]];
  const today = addDays(0);
  weekdays.forEach((date, di) => {
    sectionRosters.forEach(([classId, sectionId], ci) => {
      if (date === today && classId === "c8") return; // 8A/8B register still open today
      const list = students.filter((s) => s.enrollment?.classId === classId && s.enrollment?.sectionId === sectionId);
      const mks: Record<string, AttendanceStatus> = {};
      list.forEach((s, si) => {
        const r = rnd(di * 31 + si * 7 + ci * 13, 53);
        mks[s.id] = r < 0.055 ? "absent" : r < 0.1 ? "late" : "present";
      });
      attendance.push({ date, classId, sectionId, marks: mks });
    });
  });

  /* ---------------- fees ---------------- */
  const fees: DB["fees"] = [];
  let fid = 0;
  students.forEach((s, i) => {
    fees.push(
      { id: `fe${++fid}`, studentId: s.id, label: "Tuition — Term 1", amount: 4500, paid: i % 4 === 0 ? 2500 : 4500, due: addDays(-20) },
      { id: `fe${++fid}`, studentId: s.id, label: "Laboratory & materials", amount: 350, paid: i % 3 === 0 ? 0 : 350, due: addDays(12) }
    );
  });

  /* ---------------- role profiles (role = permission collection) ---------------- */
  const roles: DB["roles"] = [
    { id: "superadmin", name: "Super Admin", description: "Full system access, including role & permission management.", permissions: ["*"], status: "active", system: true, appliesTo: ["admin"] },
    { id: "admin", name: "School Administrator", description: "School-wide administration across all modules.", permissions: [...(DEFAULT_PERMISSIONS.admin ?? [])], status: "active", system: true, appliesTo: ["admin"] },
    { id: "coordinator", name: "Academic Coordinator", description: "Manages academic activities and results, without user/role administration.", permissions: [...(DEFAULT_PERMISSIONS.coordinator ?? [])], status: "active", system: false, appliesTo: ["admin", "teacher"] },
    { id: "teacher", name: "Teacher", description: "Academic and communication access for assigned classes and students.", permissions: [...(DEFAULT_PERMISSIONS.teacher ?? [])], status: "active", system: true, appliesTo: ["teacher"] },
    { id: "student", name: "Student", description: "Access to own academic information and permitted communication.", permissions: [...(DEFAULT_PERMISSIONS.student ?? [])], status: "active", system: true, appliesTo: ["student"] },
    { id: "guardian", name: "Parent / Family", description: "Access to registered children and their communication.", permissions: [...(DEFAULT_PERMISSIONS.guardian ?? [])], status: "active", system: true, appliesTo: ["guardian"] },
  ];

  /* ---------------- announcements (one-to-many, status workflow) ---------------- */
  const announcements: DB["announcements"] = [
    { id: "an1", title: "Water supply interruption — Friday 09:00–12:00", body: "Municipality maintenance on our line. Water off in blocks B and C Friday morning.\n\nCanteen serves a cold menu; practicals move to block A. Refill bottles before 09:00.", category: "Urgent", senderId: "u-admin", audience: { kind: "everyone" }, status: "published", createdAt: at(0, 7, 45), publishedAt: at(0, 7, 45), pinned: true, readBy: ["u-admin", "u-t1", "u-s1"] },
    { id: "an2", title: "First Semester Midterm timetable released", body: "The midterm schedule is live. Check your grade's dates and duration per subject.\n\nArrive 15 minutes early with your student ID card.", category: "Exams", senderId: "u-admin", audience: { kind: "everyone" }, status: "published", createdAt: at(2, 10), publishedAt: at(2, 10), pinned: true, readBy: ["u-admin", "u-t1", "u-t2", "u-s1", "u-g1"] },
    { id: "an3", title: "PTA General Meeting — Saturday 9:00 AM", body: "All guardians invited to the main hall. Agenda: fee adjustment, examination calendar and the results workflow.", category: "Event", senderId: "u-admin", audience: { kind: "guardians" }, status: "published", createdAt: at(3, 9), publishedAt: at(3, 9), readBy: ["u-admin", "u-g1"] },
    { id: "an4", title: "Midterm revision pack — Grade 8B families", body: "The revision pack covers units 1–4. Please ensure students finish the timed practice sheet before Friday.", category: "Academic", senderId: "u-t1", audience: { kind: "section-guardians", classId: "c8", sectionId: "sec8b" }, status: "published", createdAt: at(2, 14, 30), publishedAt: at(2, 14, 30), readBy: ["u-t1", "u-g1"] },
    { id: "an5", title: "Sports Day — house registrations close Wednesday", body: "Registrations for athletics, football and relay close next Wednesday. Sign up with your PE teacher or class monitor.", category: "Event", senderId: "u-admin", audience: { kind: "students" }, status: "scheduled", createdAt: at(1, 12), scheduledFor: at(-1, 8), readBy: ["u-admin"] },
    { id: "an6", title: "Staff meeting — Thursday 3:30 PM", body: "Agenda: midterm moderation, sports day duties, assessment structures. Please confirm attendance.", category: "General", senderId: "u-admin", audience: { kind: "teachers" }, status: "draft", createdAt: at(0, 8, 5), readBy: ["u-admin"] },
  ];

  /* ---------------- conversations & messages (relationship-based) ---------------- */
  const conversations: DB["conversations"] = [
    { id: "cv1", type: "direct", participants: ["u-t1", "u-g1"], relatedStudentId: "st1", relatedClassId: "c8", relatedSectionId: "sec8b", relatedSubjectId: "bio", createdAt: at(3, 10), updatedAt: at(0, 9, 20), status: "active" },
    { id: "cv2", type: "direct", participants: ["u-t1", "u-s1"], relatedStudentId: "st1", relatedClassId: "c8", relatedSectionId: "sec8b", relatedSubjectId: "bio", createdAt: at(2, 11), updatedAt: at(1, 15), status: "active" },
    { id: "cv3", type: "direct", participants: ["u-t2", "u-g1"], relatedStudentId: "st2", relatedClassId: "c8", relatedSectionId: "sec8b", relatedSubjectId: "eng", createdAt: at(4, 9), updatedAt: at(2, 16), status: "active" },
    { id: "cv4", type: "direct", participants: ["u-g2", "u-admin"], relatedStudentId: "st3", createdAt: at(5, 13), updatedAt: at(3, 10), status: "active" },
    { id: "cv5", type: "direct", participants: ["u-s1", "u-admin"], createdAt: at(6, 9), updatedAt: at(4, 12), status: "active" },
  ];
  const messages: DB["messages"] = [
    { id: "mg1", conversationId: "cv1", senderId: "u-t1", body: "Good morning. Abebe has been doing very well in Biology this term — I wanted to share that his lab work is excellent.", createdAt: at(3, 10, 5), readBy: ["u-t1", "u-g1"], status: "read" },
    { id: "mg2", conversationId: "cv1", senderId: "u-g1", body: "Thank you Mr. Ahmed, that's wonderful to hear. We'll keep encouraging him at home.", createdAt: at(3, 11, 0), readBy: ["u-t1", "u-g1"], status: "read" },
    { id: "mg3", conversationId: "cv1", senderId: "u-t1", body: "One reminder: the midterm revision pack is due Friday. Please make sure Abebe completes the timed practice sheet.", createdAt: at(0, 9, 20), readBy: ["u-t1"], status: "sent" },
    { id: "mg4", conversationId: "cv2", senderId: "u-s1", body: "Sir, I had a question about question 4 on the genetics worksheet.", createdAt: at(2, 11, 10), readBy: ["u-t1", "u-s1"], status: "read" },
    { id: "mg5", conversationId: "cv2", senderId: "u-t1", body: "Of course — remember the Punnett square we did in class. Try setting it up for both parents first, then combine.", createdAt: at(2, 12, 0), readBy: ["u-t1", "u-s1"], status: "read" },
    { id: "mg6", conversationId: "cv3", senderId: "u-t2", body: "Hello. Hana's reading comprehension has improved a lot this month. Keep up the great support at home!", createdAt: at(4, 9, 15), readBy: ["u-t2", "u-g1"], status: "read" },
    { id: "mg7", conversationId: "cv4", senderId: "u-g2", body: "Hello, I'd like to ask about the laboratory fee for this term.", createdAt: at(5, 13, 30), readBy: ["u-admin", "u-g2"], status: "read" },
    { id: "mg8", conversationId: "cv4", senderId: "u-admin", body: "Of course. The laboratory & materials fee is ETB 350, due with Term 1 tuition. I can email you the breakdown.", createdAt: at(3, 10, 0), readBy: ["u-admin"], status: "sent" },
    { id: "mg9", conversationId: "cv5", senderId: "u-s1", body: "Good morning. When will the midterm timetable be posted?", createdAt: at(6, 9, 30), readBy: ["u-admin", "u-s1"], status: "read" },
  ];

  /* ---------------- reports (moderation queue) ---------------- */
  const reports: DB["reports"] = [];

  /* ---------------- notifications (system-generated) ---------------- */
  const notifications: DB["notifications"] = [
    { id: "nt1", userId: "u-s1", type: "announcement", title: "First Semester Midterm timetable released", body: "Check your grade's dates and duration per subject.", at: at(2, 10), read: true },
    { id: "nt2", userId: "u-s1", type: "homework", title: "New Biology homework posted", body: "Genetics worksheet — due Friday.", at: at(1, 14), read: false },
    { id: "nt3", userId: "u-g1", type: "message", title: "Mr. Ahmed Yusuf sent you a message", body: "One reminder: the midterm revision pack is due Friday…", at: at(0, 9, 20), read: false },
    { id: "nt4", userId: "u-g1", type: "announcement", title: "PTA General Meeting — Saturday 9:00 AM", body: "All guardians invited to the main hall.", at: at(3, 9), read: false },
    { id: "nt5", userId: "u-t1", type: "system", title: "Midterm mark entry opens Monday", body: "Assessment structures are ready for your subjects.", at: at(1, 8), read: false },
    { id: "nt6", userId: "u-g2", type: "message", title: "School Administrator replied", body: "The laboratory & materials fee is ETB 350…", at: at(3, 10), read: false },
  ];

  /* ---------------- events (school calendar) ---------------- */
  const events: DB["events"] = [
    { id: "ev1", title: "First Semester Midterm Examinations", date: addDays(12), time: "08:30", location: "All blocks", category: "Exams", audience: { kind: "everyone" }, createdBy: "u-admin", description: "Midterm examinations for all grades." },
    { id: "ev2", title: "PTA General Meeting", date: addDays(4), time: "09:00", location: "Main hall", category: "Event", audience: { kind: "guardians" }, createdBy: "u-admin" },
    { id: "ev3", title: "Annual Sports Day", date: addDays(20), time: "08:00", location: "School field", category: "Event", audience: { kind: "students" }, createdBy: "u-admin" },
    { id: "ev4", title: "Staff moderation workshop", date: addDays(7), time: "15:30", location: "Staff room", category: "Academic", audience: { kind: "teachers" }, createdBy: "u-admin" },
  ];

  /* ---------------- audit log ---------------- */
  const audit: DB["audit"] = [
    { id: "au1", userId: "u-root", userName: "Dr. Selam Bekele", action: "role.create", target: "Academic Coordinator", detail: "Custom role with academic + results permissions.", at: at(10, 9) },
    { id: "au2", userId: "u-admin", userName: "Amara Tesfaye", action: "announcement.publish", target: "First Semester Midterm timetable released", detail: "Entire school", at: at(2, 10) },
    { id: "au3", userId: "u-admin", userName: "Amara Tesfaye", action: "user.deactivate", target: "Mr. Ali Omar", detail: "Account disabled — on leave.", at: at(9, 11) },
    { id: "au4", userId: "u-t1", userName: "Mr. Ahmed Yusuf", action: "conversation.open", target: "Kebede Tesema", detail: "About Abebe Kebede · Biology", at: at(3, 10) },
  ];

  return {
    users,
    years,
    classes,
    subjects,
    teachers,
    assignments,
    students,
    timetable,
    homework,
    structures,
    assessmentMarks,
    grading: [
      { min: 90, max: 100, grade: "A+", remark: "Outstanding" },
      { min: 80, max: 89.99, grade: "A", remark: "Excellent" },
      { min: 70, max: 79.99, grade: "B", remark: "Very good" },
      { min: 60, max: 69.99, grade: "C", remark: "Good" },
      { min: 50, max: 59.99, grade: "D", remark: "Fair" },
      { min: 0, max: 49.99, grade: "F", remark: "Needs improvement" },
    ],
    attendance,
    fees,
    roles,
    announcements,
    conversations,
    messages,
    reports,
    notifications,
    events,
    audit,
    settings: { schoolName: "Riverside Secondary School", motto: "Knowledge · Discipline · Service" },
  };
}
