import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Lock, LogIn, ShieldAlert, ShieldCheck, Eye, EyeOff, ArrowLeft, Loader2, Users, Baby, BookOpen, KeyRound, Database, TerminalSquare, CheckCircle2, XCircle, Copy, ExternalLink, RefreshCw, Zap } from "lucide-react";
import { homePathFor, useApp } from "../store";
import { Btn, Chip, RoleBadge } from "../ui";
import type { Role } from "../types";
import { applyMigrations } from "../lib/backend";
import { MIGRATIONS, sqlEditorUrl, PROJECT_REF } from "../lib/migrations";

const DEMO: { role: Role; label: string; name: string; username: string; password: string; icon: React.ReactNode; desc: string }[] = [
  { role: "admin", label: "Super Admin", name: "Dr. Selam Bekele", username: "root", password: "root123", icon: <ShieldCheck className="h-4 w-4" />, desc: "Roles & permissions" },
  { role: "admin", label: "Administrator", name: "Amara Tesfaye", username: "admin", password: "admin123", icon: <KeyRound className="h-4 w-4" />, desc: "Full system control" },
  { role: "teacher", label: "Teacher", name: "Mr. Ahmed Yusuf", username: "ahmed", password: "teach123", icon: <BookOpen className="h-4 w-4" />, desc: "Assigned classes only" },
  { role: "student", label: "Student", name: "Abebe Kebede", username: "abebe", password: "stud123", icon: <Users className="h-4 w-4" />, desc: "Own records only" },
  { role: "guardian", label: "Guardian", name: "Kebede Tesema", username: "kebede", password: "fam123", icon: <Baby className="h-4 w-4" />, desc: "2 registered children" },
];

type StepState = "idle" | "run" | "ok" | "fail";

/**
 * Commissioning console — shown while the Supabase project is reachable but
 * the migrations haven't been applied yet. Two paths:
 *   A. Paste the service_role key (memory only, never stored) and let the
 *      browser apply all four migrations via the Management API.
 *   B. Guided: copy each file into the SQL Editor.
 * Either way, "Re-check & connect" re-hydrates and flips the app to live mode.
 */
function SetupConsole({ onConnected }: { onConnected: () => void }) {
  const { reconnect, toast } = useApp();
  const [open, setOpen] = useState(true);
  const [path, setPath] = useState<"auto" | "guided">("auto");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const mark = (file: string, s: StepState) => setSteps((p) => ({ ...p, [file]: s }));

  const runAuto = async () => {
    if (!key.trim()) { setNotice({ tone: "warn", text: "Paste your service_role key first (it stays in this tab's memory only)." }); return; }
    setBusy(true); setNotice(null); setSteps({});
    const ok = await applyMigrations(key.trim(), MIGRATIONS, (file, state) => mark(file, state));
    setBusy(false);
    if (ok) {
      setNotice({ tone: "ok", text: "All migrations applied. Re-checking the connection…" });
      await recheck();
    }
  };

  const recheck = async () => {
    setChecking(true);
    const res = await reconnect();
    setChecking(false);
    if (res === "live") {
      toast("Connected to Supabase — live mode.", "ok");
      onConnected();
    } else {
      setNotice({ tone: "warn", text: "Schema still not detected. If you just applied the migrations, wait a moment and re-check, or use the guided path." });
    }
  };

  const copy = async (file: string, sql: string) => {
    try { await navigator.clipboard.writeText(sql); setCopied(file); setTimeout(() => setCopied(null), 1600); }
    catch { setNotice({ tone: "warn", text: "Clipboard blocked — select the file in supabase/migrations and copy manually." }); }
  };

  const done = MIGRATIONS.filter((m) => steps[m.file] === "ok").length;

  return (
    <div className="anim-rise mb-6 overflow-hidden rounded-xl border border-pine-800 bg-pine-950 text-pine-100 shadow-lg">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-pine-900/60">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-400/15 text-gold-400"><Database className="h-4.5 w-4.5" /></span>
        <span className="flex-1">
          <span className="flex items-center gap-2 font-display text-[15px] font-extrabold tracking-tight text-white">Connect the live database</span>
          <span className="mt-0.5 block text-[11.5px] text-pine-300">Project <span className="font-mono text-gold-300">{PROJECT_REF}</span> is reachable — apply the schema to enable real sign-in and persistence.</span>
        </span>
        <span className="live-dot h-2.5 w-2.5 shrink-0 rounded-full bg-gold-400" />
      </button>

      {open && (
        <div className="border-t border-pine-800/70 px-5 py-4">
          {/* path switcher */}
          <div className="flex gap-1.5">
            {([["auto", "Automatic", Zap], ["guided", "Guided (SQL Editor)", TerminalSquare]] as const).map(([id, label, Icon]) => (
              <button key={id} onClick={() => setPath(id)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all ${path === id ? "bg-gold-400 text-pine-950" : "bg-pine-900 text-pine-300 hover:text-white"}`}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {path === "auto" ? (
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.14em] text-pine-400">Service role key · never stored, never bundled</label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="eyJhbGciOi…  (service_role)"
                    className="w-full rounded-lg border border-pine-700 bg-pine-900/70 px-3.5 py-2.5 pr-11 font-mono text-[12px] text-pine-100 placeholder:text-pine-500 outline-none transition-all focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
                  />
                  <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-pine-400 hover:text-white" aria-label="Toggle key visibility">
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-pine-400">Runs entirely in your browser via the Supabase Management API. The key is held in memory for this tab only and is discarded on reload.</p>
              </div>
              <Btn variant="gold" onClick={runAuto} disabled={busy} className="w-full">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {busy ? `Applying… ${done}/${MIGRATIONS.length}` : "Apply 4 migrations"}
              </Btn>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <p className="text-[11.5px] leading-relaxed text-pine-300">Open the <a href={sqlEditorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-gold-300 underline-offset-2 hover:underline">SQL Editor <ExternalLink className="h-3 w-3" /></a> and paste each file in order, running one at a time:</p>
              {MIGRATIONS.map((m, i) => (
                <div key={m.file} className="flex items-center gap-2.5 rounded-lg border border-pine-800 bg-pine-900/50 px-3 py-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pine-800 font-mono text-[10px] font-bold text-gold-300">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11.5px] font-semibold text-white">{m.file}</span>
                    <span className="block truncate text-[10px] text-pine-400">{m.title}</span>
                  </span>
                  <button onClick={() => copy(m.file, m.sql)} className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-pine-800 px-2 py-1.5 text-[11px] font-bold text-pine-100 transition-colors hover:bg-pine-700">
                    {copied === m.file ? <CheckCircle2 className="h-3.5 w-3.5 text-gold-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === m.file ? "Copied" : "Copy"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* progress log */}
          {Object.keys(steps).length > 0 && (
            <div className="mt-4 space-y-1 rounded-lg border border-pine-800 bg-black/30 p-3 font-mono text-[11px]">
              {MIGRATIONS.filter((m) => steps[m.file]).map((m) => (
                <div key={m.file} className="flex items-center gap-2">
                  {steps[m.file] === "run" && <Loader2 className="h-3.5 w-3.5 animate-spin text-gold-400" />}
                  {steps[m.file] === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-pine-400" />}
                  {steps[m.file] === "fail" && <XCircle className="h-3.5 w-3.5 text-rust-500" />}
                  <span className={steps[m.file] === "ok" ? "text-pine-300" : steps[m.file] === "fail" ? "text-rust-400" : "text-pine-400"}>{m.file}</span>
                  {steps[m.file] === "ok" && <span className="text-pine-500">applied</span>}
                  {steps[m.file] === "fail" && <span className="text-rust-400">failed</span>}
                </div>
              ))}
            </div>
          )}

          {notice && (
            <div className={`mt-3 rounded-lg px-3.5 py-2.5 text-[12px] font-semibold ${notice.tone === "ok" ? "bg-pine-800/70 text-pine-100" : "bg-gold-400/10 text-gold-300"}`}>{notice.text}</div>
          )}

          <div className="mt-4 flex items-center gap-2 border-t border-pine-800/70 pt-3.5">
            <Btn variant="outline" onClick={recheck} disabled={checking} className="!border-pine-700 !bg-transparent !text-pine-200 hover:!bg-pine-900">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {checking ? "Checking…" : "Re-check & connect"}
            </Btn>
            <span className="text-[10.5px] text-pine-400">Until connected, you're in local demo mode — sign-in still works below.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function LoginPage() {
  const { db, login, toast, mode } = useApp();
  const nav = useNavigate();
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const doLogin = async (u: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await login(u, p);
      if (!res.ok) {
        setError(res.error ?? "Sign-in failed.");
        setShake((s) => s + 1);
        return;
      }
      if (res.user) {
        toast(`Welcome back, ${res.user.name.split(" ")[0]} — signed in as ${res.user.role}.`);
        nav(homePathFor(res.user.role), { replace: true });
      }
    } finally {
      setBusy(false);
    }
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

          {mode !== "live" && !connected && <div className="mt-5"><SetupConsole onConnected={() => setConnected(true)} /></div>}

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
