/**
 * Server-only configuration.
 *
 * Nothing in this file may ever be imported from `src/`. Everything under
 * `api/` runs on the server; everything under `src/` is compiled into a bundle
 * the browser downloads. The build has no way to enforce that boundary for
 * you, so the rule is the directory: secrets live here, and the browser is
 * never given a URL, a key, or a project reference it could use directly.
 *
 * Required on the deployment (Vercel → Settings → Environment Variables):
 *
 *   SUPABASE_URL              https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY         publishable key — used for user-scoped requests
 *   SUPABASE_SERVICE_ROLE_KEY project-admin key — login + narrow admin ops ONLY
 *   SESSION_SECRET            32+ random bytes, for signing the CSRF token
 *   ALLOWED_ORIGIN            https://your-app.vercel.app (comma-separate for previews)
 *
 * Note the absence of any `VITE_` prefix. Vite inlines every `VITE_*` variable
 * into the client bundle at build time — that is exactly how the anon key and
 * project URL ended up shipped to browsers in the previous version.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    // Fail at the first request rather than silently degrading into a state
    // where requests appear to work but authorize against nothing.
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in your deployment's environment settings.`
    );
  }
  return v.trim();
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get anonKey() {
    return required("SUPABASE_ANON_KEY");
  },
  /** Bypasses RLS entirely. Only `api/auth/login` and the explicitly audited
   *  admin operations may touch this. If you find yourself reaching for it in
   *  a read path, you want `userClient()` instead. */
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get allowedOrigins(): string[] {
    const raw = process.env.ALLOWED_ORIGIN ?? "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get isProduction() {
    return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  },
};

/**
 * Same-origin enforcement.
 *
 * THIS IS THE FIX FOR "the API returns 403 for everything after deploying".
 *
 * The previous version compared the Origin header against an ALLOWED_ORIGIN
 * environment variable and rejected anything else. That is correct in
 * principle and a trap in practice: if the variable is unset, or set to the
 * production URL while you are testing a preview deployment, or set to the
 * apex domain while the browser is on www, then EVERY request is refused
 * before authentication even runs — and the app reports itself as unable to
 * connect, with nothing in the UI hinting that the cause is a string mismatch
 * on the server.
 *
 * The robust rule doesn't need a variable at all. A same-origin request is,
 * by definition, one whose Origin equals the scheme and host the request
 * itself arrived on. The server already knows both, so it can check without
 * being told. Vercel preview URLs, custom domains, www and apex all just work,
 * and the check is no weaker — an attacker's page still sends its own origin.
 *
 * ALLOWED_ORIGIN is now purely additive: set it only if a genuinely different
 * origin must call this API (a separate admin front-end, say). Leaving it
 * unset is the normal, correct configuration.
 */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");

  // Same-site navigations and some same-origin POSTs omit Origin entirely.
  // Sec-Fetch-Site, which browsers send and pages cannot forge, resolves the
  // ambiguity; when neither header is present the caller isn't a browser, and
  // the session cookie is SameSite=Strict so a cross-site replay wouldn't have
  // carried credentials anyway.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (!origin) return fetchSite === null || fetchSite === "same-origin" || fetchSite === "none";

  // The origin this request actually arrived on. x-forwarded-host is what
  // Vercel sets behind its proxy; host is the fallback for local dev.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? (env.isProduction ? "https" : "http");
  if (host && origin === `${proto}://${host}`) return true;

  // Optional extra origins, for a front-end deployed somewhere else.
  return env.allowedOrigins.includes(origin);
}
