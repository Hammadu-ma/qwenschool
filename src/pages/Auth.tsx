import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Lock, LogIn, ShieldAlert, ShieldCheck, Eye, EyeOff, ArrowLeft, Loader2, Users, Baby, BookOpen, KeyRound } from "lucide-react";
import { homePathFor, useApp } from "../store";
import { Btn, Chip, RoleBadge } from "../ui";
import type { Role } from "../types";

const DEMO: { role: Role; label: string; name: string; username: string; password: string; icon: React.ReactNode; desc: string }[] = [
  { role: "admin", label: "Super Admin", name: "Dr. Selam Bekele", username: "root", password: "root123", icon: <ShieldCheck className="h-4 w-4" />, desc: "Roles & permissions" },
  { role: "admin", label: "Administrator", name: "Amara Tesfaye", username: "admin", password: "admin123", icon: <KeyRound className="h-4 w-4" />, desc: "Full system control" },
  { role: "teacher", label: "Teacher", name: "Mr. Ahmed Yusuf", username: "ahmed", password: "teach123", icon: <BookOpen className="h-4 w-4" />, desc: "Assigned classes only" },
  { role: "student", label: "Student", name: "Abebe Kebede", username: "abebe", password: "stud123", icon: <Users className="h-4 w-4" />, desc: "Own records only" },
  { role: "guardian", label: "Guardian", name: "Kebede Tesema", username: "kebede", password: "fam123", icon: <Baby className="h-4 w-4" />, desc: "2 registered children" },
];

export function LoginPage() {
  const { db, login, toast } = useApp();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const doLogin = (u: string, p: string) => {
    setBusy(true);
    setError(null);
    setTimeout(() => {
      const res = login(u, p);
      setBusy(false);
      if (!res.ok || !res.user) {
        setError(res.error ?? "Sign-in failed.");
        setShake((s) => s + 1);
        return;
      }
      toast(`Welcome back, ${res.user.name.split(" ")[0]} — signed in as ${res.user.role}.`);
      nav(homePathFor(res.user.role), { replace: true });
    }, 550);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter both username and password.");
      setShake((s) => s + 1);
      return;
    }
    doLogin(username, password);
  };

  return (
    <div className="flex min-h-screen">
      {/* branded panel */}
      <div className="auth-panel relative hidden w-[46%] flex-col justify-between overflow-hidden p-10 text-pine-100 lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full border-[26px] border-pine-800/60" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-72 w-72 rounded-full border-[20px] border-pine-900/80" />
        <div className="pointer-events-none absolute right-16 top-1/2 h-24 w-24 rounded-full border-[10px] border-gold-500/25" />

        <div className="relative flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-pine-800 ring-1 ring-pine-700">
            <GraduationCap className="h-6 w-6 text-gold-400" />
          </span>
          <span>
            <span className="font-display block text-[19px] font-extrabold leading-none tracking-tight text-white">{db.settings.schoolName}</span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-pine-300">{db.settings.motto}</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-400">Role-based access</p>
          <h1 className="font-display mt-3 text-[42px] font-extrabold leading-[1.05] tracking-tight text-white">
            One account.<br />The right doors open.
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-pine-200">
            Every user signs in through a single authentication system. Their role — and their relationships to
            classes, students and children — decides exactly what they can see and do.
          </p>
          <div className="mt-6 space-y-2.5">
            {[
              ["Authenticates", "one credential set, four roles"],
              ["Resolves relationships", "teacher → classes → students · guardian → children"],
              ["Enforces authorization", "every route and record check happens underneath the UI"],
            ].map(([t, s], i) => (
              <div key={t} className="anim-rise flex items-start gap-3 rounded-lg border border-pine-800 bg-pine-900/60 px-4 py-3" style={{ animationDelay: `${200 + i * 120}ms` }}>
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />
                <div>
                  <p className="text-[13px] font-bold text-white">{t}</p>
                  <p className="text-[11.5px] text-pine-300">{s}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-pine-400">AY {db.years.find((y) => y.active)?.name} · {db.students.length} students · {db.teachers.length} teachers · local demo</p>
      </div>

      {/* form panel */}
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="anim-rise w-full max-w-md">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-pine-900">
              <GraduationCap className="h-5 w-5 text-gold-400" />
            </span>
            <div>
              <p className="font-display text-[16px] font-extrabold leading-none text-ink">{db.settings.schoolName}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-soft">School Manager</p>
            </div>
          </div>

          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-gold-600">Sign in</p>
          <h2 className="font-display mt-1 text-[28px] font-extrabold tracking-tight text-ink">Who's signing in today?</h2>
          <p className="mt-1 text-[13px] text-soft">Your role and relationships load automatically after authentication.</p>

          <form key={shake} onSubmit={submit} className={`mt-6 space-y-4 ${shake ? "anim-shake" : ""}`}>
            <div>
              <label className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Username</label>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin"
                autoComplete="username"
                className="w-full rounded-lg border border-mist bg-card px-3.5 py-2.5 text-[14px] outline-none transition-all focus:border-pine-500 focus:ring-2 focus:ring-pine-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-mist bg-card px-3.5 py-2.5 pr-11 text-[14px] outline-none transition-all focus:border-pine-500 focus:ring-2 focus:ring-pine-500/20"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-soft transition-colors hover:text-ink" aria-label="Toggle password visibility">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="anim-rise flex items-center gap-2 rounded-lg border border-rust-200 bg-rust-100 px-3.5 py-2.5 text-[12.5px] font-semibold text-rust-700">
                <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <Btn type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {busy ? "Authenticating…" : "Sign in"}
            </Btn>
          </form>

          <div className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-mist" />
              <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-soft">Demo accounts — click to sign in</span>
              <span className="h-px flex-1 bg-mist" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d, i) => (
                <button
                  key={d.username}
                  onClick={() => { setUsername(d.username); setPassword(d.password); doLogin(d.username, d.password); }}
                  disabled={busy}
                  className={`anim-rise group cursor-pointer rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 ${
                    d.username === "root"
                      ? "border-gold-400/70 bg-gold-100/50 hover:border-gold-500"
                      : "border-mist bg-card hover:border-pine-400"
                  }`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="flex items-center justify-between">
                    <span className={d.username === "root" ? "text-gold-600 transition-transform group-hover:scale-110" : "text-pine-700 transition-transform group-hover:scale-110"}>{d.icon}</span>
                    {d.username === "root" ? <Chip tone="gold">Super Admin</Chip> : <RoleBadge role={d.role} />}
                  </span>
                  <span className="mt-2 block text-[12.5px] font-bold text-ink">{d.name}</span>
                  <span className="block text-[10.5px] text-soft">{d.desc}</span>
                  <span className="mt-1.5 block font-mono text-[10px] text-soft/70">{d.username} / {d.password}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-soft">
            <Lock className="h-3 w-3" /> Sessions persist across refreshes · disabled accounts are rejected at sign-in
          </p>
        </div>
      </div>
    </div>
  );
}

export function AccessDenied({ required, reason }: { required?: string; reason?: string }) {
  const { currentUser, logout } = useApp();
  const nav = useNavigate();
  return (
    <div className="anim-rise mx-auto mt-10 max-w-lg">
      <div className="overflow-hidden rounded-xl border border-rust-200 bg-card shadow-lg">
        <div className="border-b border-rust-200 bg-rust-100/70 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rust-600 text-white">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-[20px] font-extrabold tracking-tight text-rust-700">Access denied</h1>
              <p className="text-[12px] font-semibold text-rust-600/80">This route is protected by role-based authorization.</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 px-6 py-5">
          <p className="text-[13.5px] leading-relaxed text-ink">
            {reason ?? "Your account doesn't have permission to open this section. The request was blocked by the authorization layer — not just hidden from the menu."}
          </p>
          {required && (
            <p className="rounded-lg bg-paper px-3.5 py-2.5 text-[12.5px] text-soft">
              Required access: <span className="font-bold text-ink">{required}</span>
            </p>
          )}
          {currentUser && (
            <p className="flex items-center gap-2 text-[12.5px] text-soft">
              Signed in as <span className="font-bold text-ink">{currentUser.name}</span> <RoleBadge role={currentUser.role} />
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {currentUser ? (
              <>
                <Btn onClick={() => nav(homePathFor(currentUser.role))}><ArrowLeft className="h-4 w-4" /> Back to my dashboard</Btn>
                <Btn variant="outline" onClick={() => { logout(); nav("/login", { replace: true }); }}>Sign in as another user</Btn>
              </>
            ) : (
              <Btn onClick={() => nav("/login")}><LogIn className="h-4 w-4" /> Go to sign in</Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
