import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { readTokens, type SessionTokens } from "./cookies";

/**
 * Two clients, and the difference between them is the whole security model.
 *
 * userClient(token) — the anon key plus THIS user's access token. Every query
 *   it runs is subject to Row Level Security exactly as before. This is what
 *   virtually all of the API uses. Moving to a server backend did not replace
 *   RLS; it put a second, independent boundary in front of it. If a policy
 *   were wrong, the API allowlist still limits the blast radius — and if the
 *   allowlist were wrong, RLS still holds. Neither alone is the security
 *   model.
 *
 * adminClient() — the service role key. Bypasses RLS completely. Used in
 *   exactly two places: exchanging a username for an email at login (the
 *   caller is not authenticated yet, so there is no user context to run as),
 *   and refreshing a token. Every other use is a bug. If you add a third
 *   caller, the question to answer first is "why can't this run as the user?"
 *
 * The service role key is read from the environment inside this module and
 * never returned, logged, or included in a response.
 */

/** Keyed by access token so repeated calls in one invocation reuse a client. */
const userClients = new Map<string, SupabaseClient>();

export function userClient(accessToken: string): SupabaseClient {
  const cached = userClients.get(accessToken);
  if (cached) return cached;

  const client = createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      // The server holds no session state. Every request carries its own
      // token; nothing is persisted between invocations, which is what makes
      // this safe to run on a shared, recycled serverless instance.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  userClients.set(accessToken, client);
  return client;
}

let admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (admin) return admin;
  admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}

/* ===================================================================== */

export interface AuthedContext {
  tokens: SessionTokens;
  db: SupabaseClient;
  userId: string;
}

/**
 * Resolves the caller from their cookies. Returns null when there is no
 * usable session — the caller should respond 401 and let the client redirect
 * to login.
 *
 * Note what this does NOT do: it does not decode the JWT and trust its
 * claims. The token is handed to Supabase, which verifies the signature
 * server-side. A forged token fails there, not here.
 */
export async function authenticate(req: Request): Promise<AuthedContext | null> {
  const tokens = readTokens(req);
  if (!tokens?.accessToken) return null;

  const db = userClient(tokens.accessToken);
  const { data, error } = await db.auth.getUser(tokens.accessToken);
  if (error || !data?.user) return null;

  return { tokens, db, userId: data.user.id };
}

/**
 * Exchanges a refresh token for a new access token. Called by the client's
 * fetch wrapper when a request comes back 401, so a person working through a
 * long afternoon is never bounced to the login screen mid-task.
 */
export async function refreshSession(
  refreshToken: string
): Promise<{ tokens: SessionTokens; expiresIn: number; userId: string } | null> {
  if (!refreshToken) return null;
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return null;
  return {
    tokens: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    },
    expiresIn: data.session.expires_in ?? 3600,
    userId: data.session.user.id,
  };
}
