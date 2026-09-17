import { useState } from "react";
import { CheckCircle2, Copy, Database, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useApp } from "../store";
import { Btn } from "../ui";
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
 *
 * Pulled into its own lazy-loaded chunk (see Auth.tsx) because MIGRATIONS /
 * COMBINED_SQL are ?raw imports of every file in supabase/migrations — over
 * 160KB of SQL text that has no reason to ship in the login page's initial
 * bundle, since this console only renders for the rare "schema not applied
 * yet" case.
 */
export default function SetupConsole({ onConnected }: { onConnected: () => void }) {
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
