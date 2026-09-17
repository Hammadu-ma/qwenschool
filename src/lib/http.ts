/**
 * The only way the browser talks to anything.
 *
 * There is no Supabase client in the bundle any more, no project URL, no anon
 * key. Every request goes to a same-origin `/api` path, the session rides in
 * httpOnly cookies the page cannot read, and the server decides what is
 * allowed. A person reading the deployed JavaScript learns the shape of the
 * API and nothing else.
 *
 * Three things this layer does that matter for speed:
 *
 *   COALESCING   — two components mounting in the same tick and asking for
 *                  the same thing produce one network request, not two.
 *                  React Query already dedupes by query key; this catches
 *                  the calls that don't go through it.
 *   REFRESH      — a 401 triggers one token refresh and one retry, invisibly.
 *                  A single refresh is shared by every request that hit 401
 *                  at the same moment, so a page with six queries open
 *                  refreshes once rather than six times.
 *   FAST FAILURE — a request that is taking too long is aborted rather than
 *                  left to hang a loading spinner indefinitely.
 */

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The session is gone — the UI should route to login rather than retry. */
  get isAuthError() {
    return this.code === "unauthenticated";
  }
  get isPermissionError() {
    return this.code === "forbidden";
  }
}

/* ---------------------------------------------------------------- CSRF --- */

const CSRF_COOKIE = "sms_csrf";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Readable by design — it is the double-submit half of CSRF protection, not
 *  a credential. The token that actually authenticates is httpOnly. */
export const csrfToken = () => readCookie(CSRF_COOKIE);

/* ------------------------------------------------------------- refresh --- */

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // One refresh, shared. Without this, six concurrent 401s become six
  // refresh calls, five of which race and lose — and a lost race can
  // invalidate the token the winner just issued.
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so simultaneous callers all see the same
      // promise, but a later 401 can start a fresh attempt.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

/* ----------------------------------------------------------- coalescing -- */

const inFlight = new Map<string, Promise<unknown>>();

/* ------------------------------------------------------------- request --- */

interface CallOptions {
  /** Abort after this many ms. */
  timeoutMs?: number;
  /** Skip coalescing — use for writes, which are never interchangeable. */
  unique?: boolean;
  signal?: AbortSignal;
}

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  opts: CallOptions,
  isRetry = false
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  // Let a caller's own abort (component unmounted, search term changed)
  // cancel the request too.
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const token = csrfToken();
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-csrf-token": token } : {}),
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 && !isRetry) {
      // Access token expired mid-session. Refresh once and replay; the
      // person never sees it happen.
      const refreshed = await refreshSession();
      if (refreshed) return request<T>(path, body, opts, true);
    }

    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload?.ok) {
      const err = payload?.error ?? {};
      throw new ApiError(
        err.code ?? "server_error",
        err.message ?? "Something went wrong. Please try again.",
        res.status
      );
    }

    return payload.data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new ApiError("upstream_error", "That took too long. Check your connection and try again.", 0);
    }
    throw new ApiError("upstream_error", "Couldn't reach the server. Check your connection.", 0);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls an allowlisted database function through the API.
 *
 * `fn` must be one of the names in api/_lib/allowlist.ts. Anything else comes
 * back 404 — which is deliberate: the client cannot reach an operation the
 * server has not explicitly published, even if someone edits the bundle.
 */
export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown> = {},
  opts: CallOptions = {}
): Promise<T> {
  const path = `/api/rpc/${encodeURIComponent(fn)}`;

  if (opts.unique) return request<T>(path, args, opts);

  const key = `${fn}:${JSON.stringify(args)}`;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = request<T>(path, args, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Writes are never coalesced — two identical saves are two intentional acts. */
export const callWrite = <T>(fn: string, args: Record<string, unknown> = {}) =>
  callRpc<T>(fn, args, { unique: true, timeoutMs: 30_000 });

/* ---------------------------------------------------------------- auth --- */

export interface SignedInUser {
  role: "admin" | "teacher" | "student" | "guardian";
  name: string;
}

export async function apiLogin(
  username: string,
  password: string
): Promise<{ ok: true; user: SignedInUser } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      return { ok: false, error: payload?.error?.message ?? "Sign-in failed. Please try again." };
    }
    return { ok: true, user: payload.user as SignedInUser };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}

export async function apiLogout(): Promise<void> {
  const token = csrfToken();
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(token ? { "x-csrf-token": token } : {}) },
    });
  } catch {
    // The cookies expire on their own; a failed logout call must not trap
    // someone on a screen they're trying to leave.
  }
}

export interface ServerProfile {
  id: string;
  full_name: string;
  username: string;
  role: SignedInUser["role"];
  role_def_id: string;
  status: string;
  email: string | null;
  phone: string | null;
  teacher_id: string | null;
  student_id: string | null;
}

/** The authoritative "who am I". Returns null when not signed in. */
export async function apiSession(): Promise<ServerProfile | null> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    return payload?.ok ? (payload.profile as ServerProfile) : null;
  } catch {
    return null;
  }
}
