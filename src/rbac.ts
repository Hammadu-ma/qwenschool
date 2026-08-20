import type {
  Announcement, Audience, Conversation, DB, RoleDef, User,
} from "./types";
import {
  audienceContainsUser, childrenOf, guardianOfStudent, sectionShort, shortName, studentOf,
  teacherStudentIds, teachersOfStudent,
} from "./store";
import {
  ALL_PERMISSION_IDS, DEFAULT_PERMISSIONS, PERMISSION_CATALOG, PERMISSION_CATEGORIES, permDef,
} from "./permissions";

export { ALL_PERMISSION_IDS, DEFAULT_PERMISSIONS, PERMISSION_CATALOG, PERMISSION_CATEGORIES, permDef };
export type { PermissionDef } from "./permissions";

/* =========================================================================
   RBAC — centralized, two-level authorization.

   LEVEL 1 (Role permission):  hasPermission(user, "communication.send")
       — does the user's role profile grant this capability at all?

   LEVEL 2 (Relationship):     relationshipAllows(actor, target)
       — is this particular user actually connected to the target through
         the school's academic structure (assignments / enrollment / family)?

   Every protected action and every data query must pass BOTH levels.
   A role alone never grants access to a person; a relationship alone never
   grants a capability. This module is the single place both are combined.
   ========================================================================= */

const rid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();

/** Map a base role to its default role-profile id (used when creating users). */
export const defaultRoleIdFor = (role: User["role"]): string =>
  role === "admin" ? "admin" : role;

/* ================= Level 1 — role permission engine ================= */
export const getRoleProfile = (db: DB, user: User | null): RoleDef | null =>
  user ? db.roles.find((r) => r.id === user.roleId) ?? null : null;

export function hasPermission(db: DB, user: User | null, permission: string): boolean {
  if (!user || user.status !== "active") return false;
  const role = getRoleProfile(db, user);
  if (!role || role.status !== "active") return false;
  if (role.permissions.includes("*")) return true;
  return role.permissions.includes(permission);
}

/** Convenience used inside mutators: returns false and reports nothing (caller toasts). */
export const requirePermission = (db: DB, user: User | null, permission: string) =>
  hasPermission(db, user, permission);

/* ================= Level 2 — relationship engine ================= */

/**
 * Does a *current* school relationship connect actor → target?
 * Purely structural — says nothing about role capabilities.
 */
export function relationshipAllows(db: DB, actor: User, target: User): boolean {
  if (actor.id === target.id) return false;

  // Administrators are connected to the whole school.
  if (actor.role === "admin") return true;

  if (actor.role === "teacher") {
    if (target.role === "student") return teacherStudentIds(db, actor).has(target.studentId ?? "");
    if (target.role === "guardian") {
      const mine = teacherStudentIds(db, actor);
      return (target.childrenIds ?? []).some((cid) => mine.has(cid));
    }
    // Colleagues and the school office.
    return target.role === "teacher" || target.role === "admin";
  }

  if (actor.role === "student") {
    if (target.role === "teacher") {
      const me = studentOf(db, actor);
      if (!me || !target.teacherId) return false;
      return teachersOfStudent(db, me).some((t) => t.teacher.id === target.teacherId);
    }
    if (target.role === "admin") return true;
    // No student↔student or student↔parent social messaging by default.
    return false;
  }

  if (actor.role === "guardian") {
    if (target.role === "teacher") {
      return childrenOf(db, actor).some((child) =>
        teachersOfStudent(db, child).some((t) => target.teacherId != null && t.teacher.id === target.teacherId)
      );
    }
    if (target.role === "admin") return true;
    // Guardians can't message other families or students directly.
    return false;
  }

  return false;
}

/** The specific target-direction permission needed to message a given role. */
const DIRECTION_PERMISSION: Record<User["role"], string> = {
  student: "communication.message_student",
  guardian: "communication.message_parent",
  teacher: "communication.message_teacher",
  admin: "communication.message_admin",
};

export interface AuthzResult {
  ok: boolean;
  reason?: string;
}

/**
 * Full two-level check for opening/sending a one-to-one conversation.
 * Level 1: communication.send + the direction permission for the target's role.
 * Level 2: a current school relationship must exist.
 */
export function canSendMessage(db: DB, actor: User | null, target: User | null): AuthzResult {
  if (!actor || !target) return { ok: false, reason: "Not signed in." };
  if (actor.id === target.id) return { ok: false, reason: "You can't message yourself." };
  if (target.status !== "active") return { ok: false, reason: "That account is inactive, so new messages aren't allowed." };
  if (actor.status !== "active") return { ok: false, reason: "Your account is inactive." };

  if (!hasPermission(db, actor, "communication.send"))
    return { ok: false, reason: "Your role doesn't permit sending messages." };

  const dir = DIRECTION_PERMISSION[target.role];
  if (dir && !hasPermission(db, actor, dir))
    return { ok: false, reason: "Your role doesn't permit messaging that group." };

  if (!relationshipAllows(db, actor, target))
    return { ok: false, reason: "No current school relationship connects you to that person." };

  return { ok: true };
}

export const canMessageUser = canSendMessage;

/* ================= conversations ================= */
export function canViewConversation(db: DB, user: User | null, conversationId: string): boolean {
  const conv = db.conversations.find((c) => c.id === conversationId);
  if (!conv || !user) return false;
  if (conv.participants.includes(user.id)) return true;
  // Moderators can open any non-hidden conversation for review.
  return hasPermission(db, user, "communication.moderate");
}

export function conversationsFor(db: DB, user: User | null): Conversation[] {
  if (!user) return [];
  const moderating = hasPermission(db, user, "communication.moderate");
  return db.conversations
    .filter((c) => c.status !== "hidden" && (c.participants.includes(user.id) || moderating))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function unreadInConversation(db: DB, user: User | null, conv: Conversation): number {
  if (!user) return 0;
  return db.messages.filter(
    (m) => m.conversationId === conv.id && m.senderId !== user.id && !m.readBy.includes(user.id)
  ).length;
}

export const totalUnreadMessages = (db: DB, user: User | null) =>
  conversationsFor(db, user).reduce((n, c) => n + unreadInConversation(db, user, c), 0);

/** Find an existing active direct conversation between two users, if any. */
export const findDirectConversation = (db: DB, a: string, b: string) =>
  db.conversations.find(
    (c) => c.type === "direct" && c.status === "active" && c.participants.includes(a) && c.participants.includes(b)
  );

/* ================= announcements ================= */
/** Scheduled announcements become published once their time has passed. */
export function effectiveAnnouncementStatus(a: Announcement, now = Date.now()): Announcement["status"] {
  if (a.status === "scheduled" && a.scheduledFor && new Date(a.scheduledFor).getTime() <= now) return "published";
  return a.status;
}

export function canManageAnnouncement(db: DB, user: User | null, a: Announcement): boolean {
  if (!user) return false;
  return a.senderId === user.id || hasPermission(db, user, "communication.manage_announcement");
}

export function canSeeAnnouncement(db: DB, user: User | null, a: Announcement): boolean {
  if (!user) return false;
  const st = effectiveAnnouncementStatus(a);
  if (st === "published") {
    return a.senderId === user.id || canManageAnnouncement(db, user, a) || audienceContainsUser(db, user, a.audience);
  }
  // Draft / scheduled / archived are private to the sender and managers.
  return a.senderId === user.id || canManageAnnouncement(db, user, a);
}

export const visibleAnnouncements = (db: DB, user: User | null) =>
  db.announcements.filter((a) => canSeeAnnouncement(db, user, a));

export const canCreateAnnouncement = (db: DB, user: User | null) =>
  hasPermission(db, user, "communication.create_announcement");

/** Level-1 check that an audience is within this user's reach. */
export function canTargetAudience(db: DB, user: User | null, aud: Audience): AuthzResult {
  if (!canCreateAnnouncement(db, user)) return { ok: false, reason: "Your role can't create announcements." };
  if (aud.kind === "everyone" && !hasPermission(db, user, "communication.school_wide"))
    return { ok: false, reason: "School-wide announcements need the school-wide permission." };
  return { ok: true };
}

/** Resolve an audience to the set of user ids it reaches (for read tracking & notifications). */
export function audienceUserIds(db: DB, aud: Audience): string[] {
  const active = db.users.filter((u) => u.status === "active");
  switch (aud.kind) {
    case "everyone":
      return active.map((u) => u.id);
    case "teachers":
      return active.filter((u) => u.role === "teacher").map((u) => u.id);
    case "students":
      return active.filter((u) => u.role === "student").map((u) => u.id);
    case "guardians":
      return active.filter((u) => u.role === "guardian").map((u) => u.id);
    case "section-students":
      return active.filter((u) => {
        if (u.role !== "student" || !u.studentId) return false;
        const s = db.students.find((x) => x.id === u.studentId);
        return !!s?.enrollment && s.enrollment.classId === aud.classId && s.enrollment.sectionId === aud.sectionId;
      }).map((u) => u.id);
    case "section-guardians":
      return active.filter((u) =>
        u.role === "guardian" &&
        childrenOf(db, u).some((c) => c.enrollment?.classId === aud.classId && c.enrollment?.sectionId === aud.sectionId)
      ).map((u) => u.id);
  }
}

/* ================= contacts (relationship-filtered directory) ================= */
export interface ContactGroup {
  label: string;
  users: User[];
}

/**
 * Role-aware contact directory. Every entry already passes canSendMessage,
 * so the directory never reveals users this person isn't allowed to reach
 * (no data leakage — unrelated people simply don't appear).
 */
export function allowedContacts(db: DB, user: User | null): User[] {
  if (!user) return [];
  return db.users
    .filter((u) => u.id !== user.id)
    .filter((u) => canSendMessage(db, user, u).ok)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function contactGroups(db: DB, user: User | null): ContactGroup[] {
  const all = allowedContacts(db, user);
  const by = (role: User["role"]) => all.filter((u) => u.role === role);
  if (!user) return [];
  if (user.role === "admin")
    return [
      { label: "Teachers", users: by("teacher") },
      { label: "Students", users: by("student") },
      { label: "Families", users: by("guardian") },
      { label: "Administration", users: by("admin") },
    ];
  if (user.role === "teacher")
    return [
      { label: "My students", users: by("student") },
      { label: "My students' families", users: by("guardian") },
      { label: "Colleagues", users: by("teacher") },
      { label: "Administration", users: by("admin") },
    ];
  if (user.role === "student")
    return [
      { label: "My teachers", users: by("teacher") },
      { label: "Administration", users: by("admin") },
    ];
  return [
    { label: "My children's teachers", users: by("teacher") },
    { label: "Administration", users: by("admin") },
  ];
}

/** Context label for a contact (e.g. the subject a teacher is reachable about). */
export function contactContext(db: DB, user: User | null, contact: User): string {
  if (!user) return "";
  if (user.role === "student" && contact.role === "teacher" && contact.teacherId) {
    const me = studentOf(db, user);
    if (me) {
      const t = teachersOfStudent(db, me).find((x) => x.teacher.id === contact.teacherId);
      if (t) return t.subjectIds.map((s) => db.subjects.find((x) => x.id === s)?.name ?? s).join(", ");
    }
  }
  if (user.role === "guardian" && contact.role === "teacher") {
    const kids = childrenOf(db, user);
    for (const k of kids) {
      const t = teachersOfStudent(db, k).find((x) => x.teacher.id === contact.teacherId);
      if (t) return `${shortName(k)} · ${t.subjectIds.map((s) => db.subjects.find((x) => x.id === s)?.name ?? s).join(", ")}`;
    }
  }
  if ((user.role === "teacher" || user.role === "admin") && contact.role === "student" && contact.studentId) {
    const s = db.students.find((x) => x.id === contact.studentId);
    if (s?.enrollment) return sectionShort(db, s.enrollment.classId, s.enrollment.sectionId);
  }
  if (contact.role === "guardian") {
    const kids = childrenOf(db, contact).map((c) => shortName(c));
    return kids.length ? `Parent of ${kids.join(" & ")}` : "Family";
  }
  if (contact.role === "admin") return "School office";
  return "";
}

/* ================= notifications & audit (system writes) ================= */
export function pushNotifications(
  db: DB,
  userIds: string[],
  type: import("./types").AppNotification["type"],
  title: string,
  body: string
) {
  const targets = [...new Set(userIds)].filter((id) => {
    const u = db.users.find((x) => x.id === id);
    return u && u.status === "active";
  });
  for (const userId of targets) {
    db.notifications.unshift({ id: rid(), userId, type, title, body, at: nowIso(), read: false });
  }
}

export function pushAudit(
  db: DB,
  user: User | null,
  action: string,
  target: string,
  detail?: string
) {
  db.audit.unshift({
    id: rid(),
    userId: user?.id ?? "system",
    userName: user?.name ?? "System",
    action,
    target,
    detail,
    at: nowIso(),
  });
}

export const unreadNotifications = (db: DB, user: User | null) =>
  user ? db.notifications.filter((n) => n.userId === user.id && !n.read).length : 0;

export const userNotifications = (db: DB, user: User | null) =>
  user ? db.notifications.filter((n) => n.userId === user.id) : [];

/* Re-export so callers can import everything authorization-related from one place. */
export { guardianOfStudent };
