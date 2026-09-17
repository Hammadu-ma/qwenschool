import { env, originAllowed } from "../_lib/env";
import { authenticate } from "../_lib/supabase";
import { csrfValid } from "../_lib/cookies";
import { fail, json, methodGuard, readJson } from "../_lib/http";
import { rateLimit } from "../_lib/ratelimit";

export const config = { runtime: "edge" };

/**
 * POST /api/storage/presign
 *
 * Proxies the `r2-storage` Supabase Edge Function so the browser never learns
 * the Supabase project URL or holds a token to call it with. The presigned R2
 * URL that comes back is short-lived and scoped to one object key, so handing
 * it to the browser is fine — the browser PUTs the bytes straight to R2 and
 * they never pass through this function. That matters: streaming a 10MB scan
 * of a birth certificate through a serverless function would be slow, costly,
 * and pointless.
 *
 * VALIDATION HAPPENS HERE, NOT IN THE CLIENT
 * The old client-side checks were advisory — anyone could call the edge
 * function directly with whatever they liked. These are enforced.
 */

const OWNER_TYPES = new Set(["student_photo", "student_document", "fee_receipt"]);

/** Per owner type: what may be uploaded, and how big. */
const RULES: Record<string, { maxBytes: number; mime: RegExp }> = {
  student_photo: { maxBytes: 5 * 1024 * 1024, mime: /^image\/(jpeg|png|webp)$/ },
  student_document: {
    maxBytes: 20 * 1024 * 1024,
    mime: /^(image\/(jpeg|png|webp)|application\/pdf)$/,
  },
  fee_receipt: { maxBytes: 10 * 1024 * 1024, mime: /^(image\/(jpeg|png|webp)|application\/pdf)$/ },
};

export default async function handler(req: Request): Promise<Response> {
  const bad = methodGuard(req, "POST");
  if (bad) return bad;
  if (!originAllowed(req)) {
    return fail("forbidden", "Request origin not allowed.");
  }

  const ctx = await authenticate(req);
  if (!ctx) return fail("unauthenticated", "Your session has expired. Please sign in again.");
  if (!csrfValid(req)) return fail("forbidden", "Invalid request token.");

  const rl = await rateLimit(`storage:${ctx.userId}`, 60);
  if (!rl.allowed) return fail("rate_limited", "Too many uploads. Please wait a moment.");

  const body = await readJson<{
    action?: string;
    ownerType?: string;
    ownerId?: string;
    filename?: string;
    contentType?: string;
    size?: number;
    key?: string;
  }>(req, 8192);
  if (!body) return fail("invalid_request", "Malformed request.");

  const action = body.action === "presign-download" ? "presign-download" : "presign-upload";
  const ownerType = String(body.ownerType ?? "");
  if (!OWNER_TYPES.has(ownerType)) return fail("invalid_request", "Unsupported file category.");

  if (action === "presign-upload") {
    const rule = RULES[ownerType];
    const size = Number(body.size ?? 0);
    const contentType = String(body.contentType ?? "");

    if (!Number.isFinite(size) || size <= 0 || size > rule.maxBytes) {
      return fail(
        "invalid_request",
        `Files here must be under ${Math.round(rule.maxBytes / (1024 * 1024))}MB.`
      );
    }
    if (!rule.mime.test(contentType)) {
      return fail("invalid_request", "That file type isn't allowed here.");
    }
    // The filename is echoed into a storage key and, later, a download header.
    // Strip anything that could traverse a path or inject a header.
    const safeName = String(body.filename ?? "file")
      .replace(/[^\w.\- ]+/g, "_")
      .slice(0, 120);
    body.filename = safeName || "file";
  }

  try {
    // Called with the user's own token, so the edge function's own ownership
    // checks (0014_file_storage.sql) still apply — this proxy adds a layer,
    // it doesn't replace one.
    const res = await fetch(`${env.supabaseUrl}/functions/v1/r2-storage`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.tokens.accessToken}`,
        apikey: env.anonKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...body, action }),
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || (payload && typeof payload === "object" && "error" in payload)) {
      console.error("[storage] upstream refused:", res.status, payload);
      return fail("upstream_error", "The file service couldn't handle that request.");
    }
    return json({ ok: true, data: payload });
  } catch (e) {
    console.error("[storage] proxy failed:", e);
    return fail("upstream_error", "The file service is unavailable right now.");
  }
}
