import { createClient } from "@supabase/supabase-js";
import { json, methodGuard } from "../_lib/http";
import { RPC_ALLOWLIST } from "../_lib/allowlist";
import { originAllowed } from "../_lib/env";

export const config = { runtime: "edge" };

/**
 * GET /api/health
 *
 * Open this in a browser tab on the deployed site when the app says it can't
 * connect. It answers, in order, the four questions that "not connected"
 * could mean — and it is the thing that was missing: with the credentials
 * moved server-side, a misconfiguration on the server produces a generic
 * failure in the browser with no way to tell which link broke.
 *
 *   1. Are the environment variables present?
 *   2. Can this function reach the Supabase project at all?
 *   3. Have the migrations been applied — do the functions the app calls
 *      actually exist in the database?
 *   4. Is the origin check going to reject the browser?
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It reports booleans and key *names*, never values. No URL, no key, no
 * fragment of one. A missing variable and a wrong variable look the same here
 * on purpose — confirming that a guessed value is correct is a probe, not a
 * diagnostic. Nothing in the response reveals anything an attacker could use
 * beyond "this deployment is misconfigured", which they'd infer from it not
 * working anyway.
 */

/**
 * Functions probed to confirm the migrations landed.
 *
 * ONLY zero-argument-callable functions belong here. PostgREST resolves by
 * signature, so calling a function that requires arguments with `{}` returns
 * the same PGRST202 as a function that doesn't exist — which would report a
 * perfectly healthy database as missing its migrations. Every entry below
 * either takes no arguments or has a default for all of them.
 *
 * Each one is the marker for a different migration, so a partial apply shows
 * up as a specific gap rather than a vague failure.
 */
const CRITICAL: Record<string, string> = {
  get_app_bootstrap: "0012 (legacy boot path)",
  current_year_id: "0021 (year scoping)",
  get_reference: "0023 (scoped bootstrap)",
  list_students: "0024 (paged queries)",
};

export default async function handler(req: Request): Promise<Response> {
  const bad = methodGuard(req, "GET");
  if (bad) return bad;

  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
  };

  /* ---- 1. environment ---- */
  const present = (name: string) => Boolean(process.env[name]?.trim());
  const envReport = {
    SUPABASE_URL: present("SUPABASE_URL"),
    SUPABASE_ANON_KEY: present("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
    SESSION_SECRET: present("SESSION_SECRET"),
    ALLOWED_ORIGIN: present("ALLOWED_ORIGIN"), // optional — see note below
    UPSTASH_REDIS_REST_URL: present("UPSTASH_REDIS_REST_URL"), // optional
  };
  report.env = envReport;

  const missing = (["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET"] as const).filter(
    (k) => !envReport[k]
  );

  if (missing.length) {
    return json({
      ok: false,
      stage: "environment",
      problem: `Missing required environment variable(s): ${missing.join(", ")}.`,
      fix:
        "Add them in Vercel → Settings → Environment Variables for the Production " +
        "environment, then REDEPLOY. Vercel only picks up new variables on a new " +
        "build — saving them does not affect the running deployment.",
      ...report,
    });
  }

  /* ---- 2. origin ---- */
  // Reported so a 403 on every request has a visible cause rather than being
  // invisible on the server.
  report.origin = {
    seen: req.headers.get("origin"),
    requestHost: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    wouldBeAllowed: originAllowed(req),
    note:
      "ALLOWED_ORIGIN is optional. Same-origin requests are matched against " +
      "this request's own host, so preview URLs and custom domains work without it.",
  };

  /* ---- 3. reachability + 4. migrations ---- */
  try {
    const url = process.env.SUPABASE_URL!.trim();
    const anon = process.env.SUPABASE_ANON_KEY!.trim();
    const db = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const started = Date.now();
    const results: Record<string, string> = {};

    for (const fn of Object.keys(CRITICAL)) {
      const { error } = await db.rpc(fn, {});
      if (!error) {
        results[fn] = "present";
      } else if (error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message)) {
        results[fn] = `MISSING — apply migration ${CRITICAL[fn]}`;
      } else if (error.code === "42501" || /permission|not permitted|not authenticated/i.test(error.message)) {
        // Called without a session, so a permission error is the *expected*
        // answer and proves the function exists and RLS is live.
        results[fn] = "present";
      } else {
        results[fn] = `present (responded: ${error.code ?? "error"})`;
      }
    }

    report.latencyMs = Date.now() - started;
    report.functions = results;
    report.allowlistSize = Object.keys(RPC_ALLOWLIST).length;

    const absent = Object.entries(results)
      .filter(([, v]) => v.startsWith("MISSING"))
      .map(([k]) => k);

    if (absent.length) {
      return json({
        ok: false,
        stage: "migrations",
        problem:
          `The database is reachable, but these functions don't exist: ${absent.join(", ")}. ` +
          `Note that 0025 and 0026 aren't probed here (their functions all take ` +
          `required arguments, which can't be distinguished from "missing" over PostgREST) — ` +
          `apply the whole 0021–0026 range rather than only what's listed.`,
        fix:
          "Apply the migrations: `supabase db push`, or paste " +
          "supabase/migrations/0021 through 0026 into the SQL Editor in order. " +
          "Check you are pointed at the same project as SUPABASE_URL.",
        ...report,
      });
    }

    return json({
      ok: true,
      stage: "ready",
      message:
        "Environment, Supabase connection and database functions all check out. " +
        "If the app still reports a connection problem, open the browser's " +
        "Network tab and look at the first failing /api/ request — its JSON body " +
        "carries a specific error code.",
      ...report,
    });
  } catch (e) {
    return json({
      ok: false,
      stage: "connection",
      problem: "Could not reach the Supabase project from this function.",
      fix:
        "Check SUPABASE_URL is the full https://<ref>.supabase.co address with no " +
        "trailing slash, that the project is not paused (free projects pause after " +
        "inactivity), and that SUPABASE_ANON_KEY belongs to that same project — a " +
        "rotated key still returns 'Invalid API key'.",
      detail: e instanceof Error ? e.message : String(e),
      ...report,
    });
  }
}
