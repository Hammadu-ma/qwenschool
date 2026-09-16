import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Lock, LogIn, ShieldAlert, ShieldCheck, Eye, EyeOff, ArrowLeft, Loader2, Database, CheckCircle2, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { homePathFor, useApp } from "../store";
import { Btn, RoleBadge } from "../ui";
import { MIGRATIONS, COMBINED_SQL, sqlEditorUrl, PROJECT_REF } from "../lib/migrations";

/**
 * Commissioning console — shown while the Supabase project is reachable but
 * the migrations haven't been applied yet. Deliberately guided-only: this
 * screen ships in the production bundle, where anyone can open it, so it
 * must never ask for or accept a service_role / Management API key. Those
 * are full-project-admin credentials — pasting one into a browser tab means
 * it travels through client JS (visible to any XSS, browser extension, or
 * dev-tools inspection on that page) to reach api.supabase.com directly.
 * Applying schema changes is an operator/CI action, done from a trusted
 * machine via the Supabase CLI or the dashboard's SQL Editor — never from
 * the app itself. This console only helps you get the SQL there.
 */
function SetupConsole({ onConnected }: { onConnected: () => void }) {
  const { reconnect, toast } = useApp();
  const [open, setOpen] = useState(true);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showEach, setShowEach] = useState(false);

  const recheck = async () => {
    setChecking(true);
    const res = await reconnect();
    setChecking(false);
    if (res === "live") {
      toast("Connected to Supabase — live mode.", "ok");
      onConnected();
    } else if (res === "error") {
      setNotice({ tone: "warn", text: "Couldn't reach the project just now (network hiccup?). Wait a moment and re-check." });
    } else {
      setNotice({ tone: "warn", text: "Schema still not detected. If you just applied the migrations, wait a moment and re-check." });
    }
  };

  const copy = async (file: string, sql: string) => {
    try { await navigator.clipboard.writeText(sql); setCopied(file); setTimeout(() => setCopied(null), 1600); }
    catch { setNotice({ tone: "warn", text: "Clipboard blocked — select the file in supabase/migrations and copy manually." }); }
  };

  return (
    <div className="anim-rise mb-6 overflow-hidden rounded-xl border border-pine-800 bg-pine-950 text-pine-100 shadow-lg">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-pine-900/60">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-400/15 text-gold-400"><Database className="h-4.5 w-4.5" /></span>
        <span className="flex-1">
          <span className="flex items-center gap-2 font-display text-[15px] font-extrabold tracking-tight text-white">Connect the live database</span>
          <span className="mt-0.5 block text-[11.5px] text-pine-300">Project <span className="font-mono text-gold-300">{PROJECT_REF}</span> is reachable — apply the schema (once, from the Supabase dashboard) to enable real sign-in and persistence.</span>
        </span>
        <span className="live-dot h-2.5 w-2.5 shrink-0 rounded-full bg-gold-400" />
      </button>

      {open && (
        <div className="border-t border-pine-800/70 px-5 py-4">
          <div className="space-y-2">
            <p className="text-[11.5px] leading-relaxed text-pine-300">Open the <a href={sqlEditorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-gold-300 underline-offset-2 hover:underline">SQL Editor <ExternalLink className="h-3 w-3" /></a> (Supabase dashboard, not this app), paste, and click Run — once:</p>
            <button onClick={() => copy("__combined__", COMBINED_SQL)} className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-gold-400/40 bg-gold-400/10 px-3.5 py-3 text-left transition-colors hover:bg-gold-400/15">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-400 text-pine-950">
                {copied === "__combined__" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[12px] font-bold text-white">{copied === "__combined__" ? "Copied — paste it into the SQL Editor" : `Copy all ${MIGRATIONS.length} migrations as one script`}</span>
                <span className="block text-[10.5px] text-pine-400">One paste, one Run — instead of {MIGRATIONS.length} separate copy/paste/run cycles.</span>
              </span>
            </button>

            <button onClick={() => setShowEach((v) => !v)} className="cursor-pointer text-[11px] font-semibold text-pine-400 underline-offset-2 hover:text-pine-200 hover:underline">
              {showEach ? "Hide individual files" : "Prefer to run them one at a time instead? (for troubleshooting)"}
            </button>

            {showEach && MIGRATIONS.map((m, i) => (
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

          {notice && (
            <div className={`mt-3 rounded-lg px-3.5 py-2.5 text-[12px] font-semibold ${notice.tone === "ok" ? "bg-pine-800/70 text-pine-100" : "bg-gold-400/10 text-gold-300"}`}>{notice.text}</div>
          )}

          <div className="mt-4 flex items-center gap-2 border-t border-pine-800/70 pt-3.5">
            <Btn variant="outline" onClick={recheck} disabled={checking} className="!border-pine-700 !bg-transparent !text-pine-200 hover:!bg-pine-900">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {checking ? "Checking…" : "Re-check & connect"}
            </Btn>
            <span className="text-[10.5px] text-pine-400">Sign-in is disabled until the schema is applied and this reconnects.</span>
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

        <p className="relative text-[11px] text-pine-400">AY {db.years.find((y) => y.active)?.name} · {db.students.length} students · {db.teachers.length} teachers</p>
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

          <fieldset disabled={mode !== "live" && !connected} className="disabled:opacity-40">
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
          </fieldset>

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
