import { fail, json, methodGuard } from "../_lib/http";
import { clearCookies, csrfValid, withCookies } from "../_lib/cookies";
import { originAllowed } from "../_lib/env";
import { authenticate } from "../_lib/supabase";

export const config = { runtime: "edge" };

/**
 * POST /api/auth/logout
 *
 * Clears the cookies locally AND revokes the refresh token upstream. Only
 * clearing the cookie would leave a live refresh token in existence — fine
 * for the person who closed their laptop, not fine for the shared office
 * machine this system will actually run on.
 *
 * CSRF-protected like any other state change: without it, a link on another
 * site could sign people out. Low stakes, but free to prevent.
 */
export default async function handler(req: Request): Promise<Response> {
  const bad = methodGuard(req, "POST");
  if (bad) return bad;
  if (!originAllowed(req)) {
    return fail("forbidden", "Request origin not allowed.");
  }
  if (!csrfValid(req)) return fail("forbidden", "Invalid request token.");

  try {
    const ctx = await authenticate(req);
    if (ctx) {
      // Best effort — if this fails the cookies still get cleared, and the
      // access token expires on its own within the hour.
      await ctx.db.auth.signOut().catch(() => {});
    }
  } catch {
    /* fall through to clearing cookies regardless */
  }

  return withCookies(json({ ok: true }), clearCookies());
}
