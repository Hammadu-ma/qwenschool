import { ApiError, apiLogin, apiLogout, apiSession, callRpc, callWrite } from "./http";

/**
 * THE KEYS ARE GONE.
 *
 * The previous version of this file contained, in plain text, a Supabase
 * project URL and an anon key as hardcoded fallbacks — shipped in the
 * JavaScript bundle to every visitor. That is a supported Supabase pattern
 * (the anon key is publishable and RLS is the real boundary), but it means
 * anyone with the bundle can point a script at the project and probe every
 * table through PostgREST for as long as they like, limited only by whether
 * every policy is perfect. It also means a fork of the app writes into the
 * original's database.
 *
 * Now: no URL, no key, no project reference anywhere in `src/`. The browser
 * talks to `/api` on its own origin. The server holds the credentials and
 * publishes a fixed list of operations (api/_lib/allowlist.ts). RLS is still
 * there underneath, doing the same job it always did — it is now the second
 * line rather than the only one.
 *
 * ---------------------------------------------------------------------------
 * ABOUT THIS FILE'S SHAPE
 * It keeps the module's old exports so the rest of the app compiles during
 * the migration. `rpc()` and `functions.invoke()` are genuinely reimplemented
 * over the API. `from()` is NOT — it deliberately throws, with a message
 * naming the replacement.
 *
 * That choice is worth stating plainly: I could have built a generic
 * table-query endpoint and kept `from()` working, and every page would still
 * run untouched. But that endpoint would re-expose the exact surface this
 * change exists to remove — arbitrary table, arbitrary columns, arbitrary
 * filters — and it would have been invisible, because everything would have
 * kept working. A loud error at the call site is worse for a day and better
 * forever.
 * ---------------------------------------------------------------------------
 */

/** Nothing to configure in the browser any more — the server holds it all. */
export const isSupabaseConfigured = true;

/** Kept as an export because older modules import it. There is no project URL
 *  in the client bundle now; anything that needs one is server-side. */
export const supabaseProjectUrl: string | null = null;

/** Username to login email mapping now happens on the server, where the real
 *  profile row can be consulted. Kept only so existing imports resolve. */
export const usernameToEmail = (username: string) =>
  username.includes("@") ? username.trim().toLowerCase() : `${username.trim().toLowerCase()}@riverside.school`;

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

async function wrap<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await run(), error: null };
  } catch (e) {
    const err = e instanceof ApiError ? e : null;
    return {
      data: null,
      error: { message: err?.message ?? "Request failed.", code: err?.code },
    };
  }
}

/** Reads the non-secret hint cookie the server sets alongside the session. */
function readHint(): { role: string; name: string; exp: number } | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)sms_hint=([^;]*)/);
    if (!m) return null;
    const parsed = JSON.parse(decodeURIComponent(m[1]));
    if (!parsed?.role || !parsed?.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

type AuthListener = (event: string, session: { user: { id: string } } | null) => void;
const listeners = new Set<AuthListener>();

function emit(event: string, userId: string | null) {
  const session = userId ? { user: { id: userId } } : null;
  for (const fn of listeners) {
    try {
      fn(event, session);
    } catch {
      /* one bad listener must not break the others */
    }
  }
}

const READ_FUNCTIONS = new Set([
  "get_bootstrap", "get_reference", "my_scope", "list_students", "get_student_detail",
  "get_marksheet", "get_register", "get_attendance_summary", "list_fees",
  "list_conversations", "list_messages", "list_notifications", "list_audit",
]);

/**
 * A narrow stand-in for the supabase-js client, backed entirely by `/api`.
 * It implements what this application actually used — not the library.
 */
export const supabase = {
  /* ------------------------------- auth ------------------------------- */
  auth: {
    async getSession(): Promise<Result<{ session: { user: { id: string } } | null }>> {
      const profile = await apiSession();
      return { data: { session: profile ? { user: { id: profile.id } } : null }, error: null };
    },

    async getUser(): Promise<Result<{ user: { id: string } | null }>> {
      const profile = await apiSession();
      return { data: { user: profile ? { id: profile.id } : null }, error: null };
    },

    /**
     * NOTE THE SIGNATURE CHANGE. The old call took `{ email, password }`
     * because the client did the username-to-email mapping itself. The server
     * does that now — it can look up the real profile row, which is what
     * migration 0018 existed to fix — so this accepts either shape and sends
     * whichever identifier it was given.
     */
    async signInWithPassword(creds: { email?: string; username?: string; password: string }) {
      const identifier = (creds.username ?? creds.email ?? "").replace(/@riverside\.school$/i, "");
      const result = await apiLogin(identifier, creds.password);
      if (!result.ok) {
        return { data: { user: null, session: null }, error: { message: result.error } };
      }
      const profile = await apiSession();
      if (!profile) {
        return { data: { user: null, session: null }, error: { message: "Sign-in failed." } };
      }
      emit("SIGNED_IN", profile.id);
      return {
        data: { user: { id: profile.id }, session: { user: { id: profile.id } } },
        error: null,
      };
    },

    async signOut() {
      await apiLogout();
      emit("SIGNED_OUT", null);
      return { error: null };
    },

    onAuthStateChange(cb: AuthListener) {
      listeners.add(cb);
      // Fire once with whatever the session actually is, so a caller that only
      // listens (rather than also calling getSession) isn't left blank.
      if (readHint()) {
        void apiSession().then((p) => cb("INITIAL_SESSION", p ? { user: { id: p.id } } : null));
      }
      return {
        data: { subscription: { unsubscribe: () => listeners.delete(cb) } },
      };
    },
  },

  /* -------------------------------- rpc -------------------------------- */
  /** Allowlisted database functions. Reads are coalesced; writes are not. */
  rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
    return wrap(() => (READ_FUNCTIONS.has(fn) ? callRpc<T>(fn, args) : callWrite<T>(fn, args)));
  },

  /* ------------------------------ storage ------------------------------ */
  functions: {
    async invoke<T = unknown>(name: string, opts: { body: Record<string, unknown> }): Promise<Result<T>> {
      if (name !== "r2-storage") {
        return { data: null, error: { message: `Function "${name}" is not available from the browser.` } };
      }
      return wrap(async () => {
        const token = document.cookie.match(/(?:^|;\s*)sms_csrf=([^;]*)/)?.[1];
        const res = await fetch("/api/storage/presign", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            ...(token ? { "x-csrf-token": decodeURIComponent(token) } : {}),
          },
          body: JSON.stringify(opts.body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.ok) {
          throw new ApiError(
            payload?.error?.code ?? "upstream_error",
            payload?.error?.message ?? "File request failed.",
            res.status
          );
        }
        return payload.data as T;
      });
    },
  },

  /* ------------------------------- tables ------------------------------ */
  /**
   * Intentionally unavailable. See the note at the top of this file.
   *
   * The replacement for each table access is a named hook in src/lib/api.ts —
   * `useStudents`, `useFees`, `useMarksheet`, `useRegister` and so on — or a
   * new allowlisted function if what you need isn't published yet.
   */
  from(table: string): never {
    throw new Error(
      `Direct table access to "${table}" is no longer available from the browser. ` +
        `All data now goes through the API: use the hooks in src/lib/api.ts, or add a ` +
        `function to supabase/migrations and publish it in api/_lib/allowlist.ts.`
    );
  },

  channel(): never {
    throw new Error(
      "Realtime subscriptions are not available through the API bridge. " +
        "Poll via React Query's refetchInterval, or add a server-sent-events endpoint under api/."
    );
  },
};
