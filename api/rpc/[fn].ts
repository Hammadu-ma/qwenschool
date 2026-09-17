import { fail, failFromPostgres, json, methodGuard, readJson, clientIp } from "../_lib/http";
import { csrfValid } from "../_lib/cookies";
import { originAllowed } from "../_lib/env";
import { authenticate } from "../_lib/supabase";
import { RPC_ALLOWLIST, isReadOnly, rateLimitFor, validateArgs } from "../_lib/allowlist";
import { rateHeaders, rateLimit } from "../_lib/ratelimit";

export const config = { runtime: "edge" };

/**
 * POST /api/rpc/<function-name>
 *
 * The entire data surface of the application. Everything the browser can do
 * to the database happens through this one door, and the door checks, in
 * order:
 *
 *   1. origin        — the request came from our app, not someone else's page
 *   2. authenticated — a valid session cookie, verified by Supabase, not by us
 *   3. allowlisted   — the named function is one of the ones in allowlist.ts
 *   4. CSRF          — for anything that writes
 *   5. rate limit    — per user, per function
 *   6. validated     — arguments match the declared schema; extras are dropped
 *   7. RLS           — and then PostgreSQL decides what this user may see
 *
 * Step 7 is the one that actually protects the data. Steps 1–6 exist so that
 * a mistake in step 7 is not immediately fatal, and so that the surface an
 * attacker can probe is one endpoint with twenty-odd named operations rather
 * than a full PostgREST API over every table in the schema.
 *
 * WHY EVERYTHING IS POST, INCLUDING READS
 * Read arguments (a student id, a search term, a class) end up in URLs if
 * they're query parameters, and URLs end up in access logs, proxy logs,
 * browser history and Referer headers. In a system holding children's
 * records, keeping those in a request body is worth losing HTTP caching over
 * — and these responses are `no-store` anyway, so there was no cache to lose.
 */
export default async function handler(req: Request): Promise<Response> {
  const bad = methodGuard(req, "POST");
  if (bad) return bad;

  if (!originAllowed(req)) {
    return fail("forbidden", "Request origin not allowed.");
  }

  // .../api/rpc/list_students → "list_students"
  const fn = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";

  // Checked before authentication so an unknown name costs nothing, and
  // worded identically to a permission failure so the allowlist can't be
  // mapped by probing.
  if (!Object.prototype.hasOwnProperty.call(RPC_ALLOWLIST, fn)) {
    return fail("not_found", "Unknown operation.");
  }

  const ctx = await authenticate(req);
  if (!ctx) return fail("unauthenticated", "Your session has expired. Please sign in again.");

  const writes = !isReadOnly(fn);
  if (writes && !csrfValid(req)) {
    return fail("forbidden", "Invalid request token. Please refresh the page.");
  }

  const limit = rateLimitFor(fn);
  const rl = await rateLimit(`rpc:${ctx.userId}:${fn}`, limit);
  if (!rl.allowed) {
    console.warn(`[rpc] rate limited user=${ctx.userId} fn=${fn} ip=${clientIp(req)}`);
    return fail("rate_limited", "You're going a bit fast. Try again in a moment.", rateHeaders(rl, limit));
  }

  const body = await readJson(req);
  if (!body) return fail("invalid_request", "Malformed request.");

  const validated = validateArgs(fn, body);
  if (!validated.ok) return fail("invalid_request", validated.error ?? "Invalid request.");

  const started = Date.now();
  try {
    // Runs as the signed-in user. RLS applies exactly as it did when the
    // browser held the token — the token just lives somewhere safer now.
    const { data, error } = await ctx.db.rpc(fn, validated.args ?? {});

    if (error) return failFromPostgres(error, `rpc ${fn}`);

    const ms = Date.now() - started;
    // Slow-query visibility without logging any of the data itself.
    if (ms > 1000) console.warn(`[rpc] slow: ${fn} took ${ms}ms for user ${ctx.userId}`);

    return json({ ok: true, data: data ?? null }, 200, {
      ...rateHeaders(rl, limit),
      "server-timing": `db;dur=${ms}`,
    });
  } catch (e) {
    console.error(`[rpc] ${fn} threw:`, e);
    return fail("server_error", "Something went wrong. Please try again.");
  }
}
