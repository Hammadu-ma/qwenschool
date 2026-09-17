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
 * Same-origin enforcement. The session cookie is SameSite=Strict, which
 * already stops the browser sending it cross-site, but an explicit Origin
 * check costs nothing and covers the cases SameSite doesn't (older clients,
 * non-browser callers replaying a stolen cookie).
 *
 * In development, when ALLOWED_ORIGIN is unset, any localhost origin passes.
 */
export function originAllowed(origin: string | null): boolean {
  if (!origin) return !env.isProduction; // same-origin fetches may omit it
  const allowed = env.allowedOrigins;
  if (allowed.length === 0) {
    return !env.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return allowed.includes(origin);
}
