import { fail, json, methodGuard } from "../_lib/http";
import { newCsrfToken, readTokens, sessionCookies, withCookies } from "../_lib/cookies";
import { authenticate, refreshSession, userClient } from "../_lib/supabase";

export const config = { runtime: "edge" };

/**
 * GET  /api/auth/session   — who am I, according to the server
 * POST /api/auth/session   — refresh an expired access token
 *
 * The client calls GET once on boot to confirm the optimistic state it
 * painted from the (non-secret) hint cookie, and POST automatically when a
 * request comes back 401. A teacher entering marks for an hour should never
 * be dropped at the login screen because a token rolled over.
 */
export default async function handler(req: Request): Promise<Response> {
  const bad = methodGuard(req, "GET", "POST");
  if (bad) return bad;

  if (req.method === "GET") {
    const ctx = await authenticate(req);
    if (!ctx) return fail("unauthenticated", "Not signed in.");

    const { data, error } = await ctx.db
      .from("profiles")
      .select("id, full_name, username, role, role_def_id, status, email, phone, teacher_id, student_id")
      .eq("id", ctx.userId)
      .maybeSingle();

    if (error || !data) return fail("unauthenticated", "Not signed in.");
    if (data.status !== "active") return fail("forbidden", "This account has been disabled.");

    return json({ ok: true, profile: data });
  }

  // --- refresh ---
  const tokens = readTokens(req);
  if (!tokens?.refreshToken) return fail("unauthenticated", "Session expired. Please sign in again.");

  const refreshed = await refreshSession(tokens.refreshToken);
  if (!refreshed) return fail("unauthenticated", "Session expired. Please sign in again.");

  const db = userClient(refreshed.tokens.accessToken);
  const { data: me } = await db
    .from("profiles")
    .select("role, full_name, status")
    .eq("id", refreshed.userId)
    .maybeSingle();

  if (!me || me.status !== "active") {
    return fail("forbidden", "This account has been disabled.");
  }

  // The CSRF token is rotated with the session, so a token captured from an
  // earlier session can't be replayed against a new one.
  const csrf = newCsrfToken();
  return withCookies(
    json({ ok: true, csrfToken: csrf, user: { role: me.role, name: me.full_name } }),
    sessionCookies(
      refreshed.tokens,
      csrf,
      { role: me.role, name: me.full_name, exp: Math.floor(Date.now() / 1000) + refreshed.expiresIn },
      refreshed.expiresIn
    )
  );
}
