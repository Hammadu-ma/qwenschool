import { env } from "./env";

/**
 * Session transport.
 *
 * WHAT CHANGED AND WHY
 * Before, `@supabase/supabase-js` persisted the access and refresh tokens in
 * localStorage, where any script on the page can read them — a single XSS, or
 * one compromised npm dependency, walks away with a token that authenticates
 * as that user until it expires. That is the standard trade-off Supabase makes
 * for a browser-direct architecture, and it is the main thing moving to a
 * server backend buys you.
 *
 * Now both tokens live in httpOnly cookies. JavaScript in the page cannot read
 * them at all — not the app's own code, not an injected script. The browser
 * attaches them to same-origin `/api` requests and nothing else.
 *
 * COOKIE FLAGS, AND WHY EACH ONE
 *   HttpOnly   — script can't read it. The whole point.
 *   Secure     — never sent over plain HTTP.
 *   SameSite=Strict — the browser won't attach it to a request originating
 *                from another site, which is CSRF defence at the transport
 *                layer rather than the application layer.
 *   Path=/api  — not sent with page/asset requests, so it isn't in logs or
 *                CDN request lines it has no business being in.
 *
 * The CSRF token is deliberately NOT httpOnly: the client must read it to echo
 * it back in a header. That is the double-submit pattern, and it is safe
 * because an attacker on another origin can neither read the cookie nor set
 * the header.
 */

const ACCESS = "sms_at";
const REFRESH = "sms_rt";
const CSRF = "sms_csrf";
/** Readable by the client on purpose — carries no credential, only enough to
 *  paint the right shell on the first frame. See src/lib/session.ts. */
const HINT = "sms_hint";

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionHint {
  role: string;
  name: string;
  exp: number;
}

/* ------------------------------ parsing ------------------------------ */

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie");
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function readTokens(req: Request): SessionTokens | null {
  const c = parseCookies(req);
  if (!c[ACCESS]) return null;
  return { accessToken: c[ACCESS], refreshToken: c[REFRESH] ?? "" };
}

export function readCsrfCookie(req: Request): string | null {
  return parseCookies(req)[CSRF] ?? null;
}

/* ------------------------------ writing ------------------------------ */

function serialize(
  name: string,
  value: string,
  opts: { maxAge: number; httpOnly: boolean; path?: string }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/api"}`,
    `Max-Age=${opts.maxAge}`,
    "SameSite=Strict",
  ];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (env.isProduction) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Builds the Set-Cookie headers for a freshly established session.
 *
 * Note `Response` allows repeated Set-Cookie headers only via `Headers.append`,
 * so this returns an array the caller appends one at a time rather than a
 * single object — collapsing them into one header silently drops all but the
 * last cookie, which is a fun afternoon to debug.
 */
export function sessionCookies(
  tokens: SessionTokens,
  csrfToken: string,
  hint: SessionHint,
  accessTtlSeconds: number
): string[] {
  // Refresh tokens are long-lived by design; the access token is short.
  const refreshTtl = 60 * 60 * 24 * 14; // 14 days
  return [
    serialize(ACCESS, tokens.accessToken, { maxAge: accessTtlSeconds, httpOnly: true }),
    serialize(REFRESH, tokens.refreshToken, { maxAge: refreshTtl, httpOnly: true }),
    serialize(CSRF, csrfToken, { maxAge: refreshTtl, httpOnly: false }),
    // The hint is readable by the app and sent on every path, because the
    // page itself (not just /api) needs it to decide what to render first.
    serialize(HINT, JSON.stringify(hint), { maxAge: refreshTtl, httpOnly: false, path: "/" }),
  ];
}

export function clearCookies(): string[] {
  const kill = (name: string, path: string, httpOnly: boolean) =>
    serialize(name, "", { maxAge: 0, httpOnly, path });
  return [
    kill(ACCESS, "/api", true),
    kill(REFRESH, "/api", true),
    kill(CSRF, "/api", false),
    kill(HINT, "/", false),
  ];
}

export function withCookies(res: Response, cookies: string[]): Response {
  const headers = new Headers(res.headers);
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers });
}

/* ------------------------------ CSRF ------------------------------ */

export function newCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Double-submit verification, in constant time.
 *
 * A timing-safe comparison matters here for the same reason it does for any
 * secret: a naive `===` short-circuits on the first differing character, and
 * the difference is measurable over enough requests.
 */
export function csrfValid(req: Request): boolean {
  const cookie = readCsrfCookie(req);
  const header = req.headers.get("x-csrf-token");
  if (!cookie || !header || cookie.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
