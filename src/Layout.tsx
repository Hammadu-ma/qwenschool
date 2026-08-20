import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Banknote, Bell, CalendarCheck2, CalendarDays, ClipboardList, Clock as ClockIcon, FileBarChart2, GraduationCap,
  HeartHandshake, History, Inbox, KeyRound, LayoutDashboard, Layers, LogOut, Megaphone, Menu, RefreshCw,
  ShieldAlert, ShieldCheck, Table2, Users, X, Contact,
  AlertTriangle, Check, ChevronDown, User, BookOpen, Baby, PenLine,
} from "lucide-react";
import { homePathFor, useApp } from "./store";
import { hasPermission, totalUnreadMessages, unreadNotifications } from "./rbac";
import { Chip, RoleBadge, UserAvatar } from "./ui";
import type { Role } from "./types";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Optional Level-1 permission gate — the item is hidden without it. */
  perm?: string;
}
interface NavGroup {
  group: string;
  items: NavItem[];
}

const COMM_ITEMS: NavItem[] = [
  { to: "/announcements", label: "Announcements", icon: <Megaphone className="h-4 w-4" />, perm: "communication.view" },
  { to: "/messages", label: "Messages", icon: <Inbox className="h-4 w-4" />, perm: "communication.view" },
  { to: "/notifications", label: "Notifications", icon: <Bell className="h-4 w-4" />, perm: "communication.view" },
  { to: "/events", label: "Events", icon: <CalendarDays className="h-4 w-4" />, perm: "events.view" },
  { to: "/contacts", label: "Contacts", icon: <Contact className="h-4 w-4" />, perm: "communication.view" },
];

const NAV: Record<Role, NavGroup[]> = {
  admin: [
    { group: "Front office", items: [{ to: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }] },
    {
      group: "People",
      items: [
        { to: "/admin/students", label: "Students", icon: <Users className="h-4 w-4" /> },
        { to: "/admin/teachers", label: "Teachers", icon: <Contact className="h-4 w-4" /> },
        { to: "/admin/families", label: "Families", icon: <HeartHandshake className="h-4 w-4" /> },
      ],
    },
    {
      group: "Academics",
      items: [
        { to: "/admin/classes", label: "Classes & sections", icon: <Layers className="h-4 w-4" /> },
        { to: "/admin/timetable", label: "Timetable", icon: <ClockIcon className="h-4 w-4" /> },
        { to: "/admin/marks", label: "Mark entry", icon: <Table2 className="h-4 w-4" /> },
        { to: "/admin/assignments", label: "Assignments", icon: <ClipboardList className="h-4 w-4" /> },
        { to: "/admin/reports", label: "Reports", icon: <FileBarChart2 className="h-4 w-4" /> },
      ],
    },
    {
      group: "Administration",
      items: [
        { to: "/admin/attendance", label: "Attendance", icon: <CalendarCheck2 className="h-4 w-4" /> },
        { to: "/admin/fees", label: "Fees", icon: <Banknote className="h-4 w-4" /> },
        { to: "/admin/users", label: "Users & roles", icon: <ShieldCheck className="h-4 w-4" />, perm: "users.manage" },
        { to: "/admin/roles", label: "Roles & permissions", icon: <KeyRound className="h-4 w-4" />, perm: "roles.manage" },
        { to: "/admin/audit", label: "Audit log", icon: <History className="h-4 w-4" />, perm: "audit.view" },
      ],
    },
    { group: "Communication", items: [...COMM_ITEMS, { to: "/moderation", label: "Moderation", icon: <ShieldAlert className="h-4 w-4" />, perm: "communication.moderate" }] },
  ],
  teacher: [
    { group: "Overview", items: [{ to: "/teacher/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }] },
    {
      group: "Teaching",
      items: [
        { to: "/teacher/classes", label: "My classes", icon: <Layers className="h-4 w-4" /> },
        { to: "/teacher/students", label: "My students", icon: <Users className="h-4 w-4" /> },
        { to: "/teacher/attendance", label: "Attendance", icon: <CalendarCheck2 className="h-4 w-4" /> },
        { to: "/teacher/marks", label: "Mark entry", icon: <Table2 className="h-4 w-4" /> },
        { to: "/teacher/assignments", label: "Assignments", icon: <ClipboardList className="h-4 w-4" /> },
      ],
    },
    { group: "Communication", items: COMM_ITEMS },
    { group: "Account", items: [{ to: "/profile", label: "My profile", icon: <User className="h-4 w-4" /> }] },
  ],
  student: [
    { group: "Overview", items: [{ to: "/student/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }] },
    {
      group: "Learning",
      items: [
        { to: "/student/classes", label: "My classes", icon: <BookOpen className="h-4 w-4" /> },
        { to: "/student/grades", label: "My grades", icon: <FileBarChart2 className="h-4 w-4" /> },
        { to: "/student/attendance", label: "My attendance", icon: <CalendarCheck2 className="h-4 w-4" /> },
        { to: "/student/assignments", label: "My assignments", icon: <PenLine className="h-4 w-4" /> },
      ],
    },
    { group: "Communication", items: COMM_ITEMS },
    { group: "Account", items: [{ to: "/profile", label: "My profile", icon: <User className="h-4 w-4" /> }] },
  ],
  guardian: [
    { group: "Overview", items: [{ to: "/guardian/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }] },
    {
      group: "Family",
      items: [
        { to: "/guardian/children", label: "My children", icon: <Baby className="h-4 w-4" /> },
        { to: "/guardian/grades", label: "Grades", icon: <FileBarChart2 className="h-4 w-4" /> },
        { to: "/guardian/attendance", label: "Attendance", icon: <CalendarCheck2 className="h-4 w-4" /> },
        { to: "/guardian/assignments", label: "Assignments", icon: <PenLine className="h-4 w-4" /> },
      ],
    },
    { group: "Communication", items: COMM_ITEMS },
    { group: "Account", items: [{ to: "/profile", label: "My profile", icon: <User className="h-4 w-4" /> }] },
  ],
};

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hidden text-right leading-tight md:block">
      <p className="tnum font-mono text-[12.5px] font-semibold text-ink">
        {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
      <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-soft">
        {now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
      </p>
    </div>
  );
}

export function AppShell() {
  const { db, currentUser, logout, yearId, setYear, ui, dismissToast, resetData } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // any navigation closes the drawer; also scrolls to top
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const toastId = ui.toast?.id;
  useEffect(() => {
    if (!toastId) return;
    const t = setTimeout(dismissToast, 3400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastId]);

  if (!currentUser) return <Navigate to="/login" replace />;

  const groups = NAV[currentUser.role];
  const unreadMsgs = totalUnreadMessages(db, currentUser);
  const unreadNotifs = unreadNotifications(db, currentUser);
  const year = db.years.find((y) => y.id === yearId);

  const sidebar = (
    <div className="flex h-full w-[240px] flex-col bg-pine-950 text-pine-100"
      style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 2px, transparent 2px 4px)" }}>
      <button onClick={() => nav(homePathFor(currentUser.role))} className="flex cursor-pointer items-center gap-3 px-5 pb-4 pt-5 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pine-800 ring-1 ring-pine-700">
          <GraduationCap className="h-5 w-5 text-gold-400" />
        </span>
        <span>
          <span className="font-display block text-[15px] font-extrabold leading-none tracking-tight text-white">Riverside</span>
          <span className="mt-1 block text-[9.5px] font-semibold uppercase tracking-[0.18em] text-pine-300">School Manager</span>
        </span>
      </button>

      <div className="mx-4 mb-3 flex items-center justify-between rounded-lg border border-pine-800 bg-pine-900/70 px-3 py-2">
        <span className="font-mono text-[11px] font-semibold text-gold-300">AY {year?.name}</span>
        <span className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-pine-300">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-gold-400" /> {year?.active ? "Active" : "Archived"}
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => {
          const items = g.items.filter((it) => !it.perm || hasPermission(db, currentUser, it.perm));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mt-3">
              <p className="px-2 pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.2em] text-pine-400/80">{g.group}</p>
              {items.map((it) => {
                const badge =
                  it.to === "/messages" && unreadMsgs > 0 ? unreadMsgs
                  : it.to === "/notifications" && unreadNotifs > 0 ? unreadNotifs
                  : 0;
                return (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) =>
                      `group relative mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-all duration-150 ${
                        isActive ? "bg-pine-800 text-white shadow-sm" : "text-pine-200/85 hover:bg-pine-900 hover:text-white"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-gold-400" />}
                        <span className={isActive ? "text-gold-400" : "text-pine-400 group-hover:text-pine-200"}>{it.icon}</span>
                        <span className="flex-1">{it.label}</span>
                        {badge > 0 && <span className="live-dot rounded-full bg-gold-400 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-pine-950">{badge}</span>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-pine-800/80 p-3">
        {currentUser.role === "admin" && (
          <button onClick={resetData} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-semibold text-pine-300 transition-colors hover:bg-pine-900 hover:text-white">
            <RefreshCw className="h-3.5 w-3.5" /> Reset demo data
          </button>
        )}
        <p className="mt-1 px-2.5 text-[10px] text-pine-500">Riverside SMS · role-based access demo</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-[240px]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-pine-950/60" onClick={() => setMobileOpen(false)} />
          <div className="anim-rise absolute inset-y-0 left-0">{sidebar}</div>
          <button onClick={() => setMobileOpen(false)} className="absolute left-[248px] top-4 cursor-pointer rounded-lg bg-pine-800 p-2 text-white"><X className="h-4 w-4" /></button>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-mist bg-card/85 backdrop-blur-md">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="cursor-pointer rounded-lg border border-mist p-2 text-soft transition-colors hover:border-pine-400 hover:text-pine-700 lg:hidden" aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden text-[10.5px] font-bold uppercase tracking-[0.14em] text-soft md:block">Academic year</span>
            <div className="relative">
              <select
                value={yearId}
                onChange={(e) => setYear(e.target.value)}
                className="cursor-pointer appearance-none rounded-lg border border-pine-300 bg-pine-50 py-1.5 pl-2.5 pr-7 font-mono text-[11.5px] font-semibold text-pine-800 outline-none transition-colors hover:border-pine-500 sm:pl-3 sm:pr-8 sm:text-[12.5px]"
              >
                {db.years.map((y) => (
                  <option key={y.id} value={y.id}>{y.name}{y.active ? " · active" : ""}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pine-600 sm:right-2" />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Clock />
            <span className="hidden h-6 w-px bg-mist md:block" />
            <div className="flex items-center gap-2 rounded-lg border border-mist bg-paper py-1 pl-1 pr-2">
              <UserAvatar name={currentUser.name} role={currentUser.role} size={28} />
              <span className="hidden sm:block">
                <span className="block max-w-[130px] truncate text-[12px] font-bold leading-tight text-ink">{currentUser.name}</span>
                <RoleBadge role={currentUser.role} />
              </span>
            </div>
            <button
              onClick={() => { logout(); nav("/login", { replace: true }); }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-mist px-2.5 py-2 text-[12px] font-bold text-soft transition-all hover:border-rust-500 hover:bg-rust-100 hover:text-rust-700"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      {ui.toast && (
        <div key={ui.toast.id} className="anim-toast fixed bottom-4 left-4 right-4 z-[70] sm:bottom-5 sm:left-auto sm:right-5">
          <div className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 shadow-xl ${ui.toast.tone === "ok" ? "border-pine-800 bg-pine-900 text-pine-50" : "border-rust-700 bg-rust-600 text-white"}`}>
            {ui.toast.tone === "ok" ? <Check className="h-4 w-4 text-gold-400" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="text-[13px] font-semibold">{ui.toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
