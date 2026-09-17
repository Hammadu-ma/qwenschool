/**
 * Request/response plumbing shared by every endpoint.
 *
 * Two rules enforced here that matter more than they look:
 *
 * 1. NO RESPONSE EVER CARRIES AN INTERNAL ERROR MESSAGE. A PostgreSQL error
 *    string routinely contains table names, column names, constraint names
 *    and sometimes row values. Those go to the server log with a correlation
 *    id; the client gets a stable code and a sentence a person can act on.
 *
 * 2. NO RESPONSE IS EVER CACHED BY AN INTERMEDIARY. Every payload here is
 *    scoped to one signed-in person. A shared cache holding one user's
 *    student list and serving it to another is the worst bug this system
 *    could have, so `private, no-store` is set on every response rather than
 *    per-endpoint.
 */

export type Json = Record<string, unknown> | unknown[] | null;

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  // These endpoints return data, never markup — so nothing should ever be
  // able to execute in their context.
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

export function json(body: Json, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

/** Stable, client-safe error codes. The UI switches on `code`, never on text. */
export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "conflict"
  | "upstream_error"
  | "server_error";

const STATUS_FOR: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  conflict: 409,
  upstream_error: 502,
  server_error: 500,
};

export function fail(
  code: ErrorCode,
  message: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return json({ error: { code, message } }, STATUS_FOR[code], extraHeaders);
}

/**
 * Turns a PostgREST/PostgreSQL error into a client-safe response and logs the
 * real thing. `ref` is a short correlation id so a support request ("I got
 * error a3f91c") can be tied to a specific log line.
 */
export function failFromPostgres(err: { code?: string; message?: string }, context: string): Response {
  const ref = Math.random().toString(36).slice(2, 8);
  console.error(`[${ref}] ${context}:`, err?.code, err?.message);

  const pgCode = err?.code ?? "";
  // SQLSTATE 42501 = insufficient_privilege — what our RLS policies and the
  // `raise exception … errcode = '42501'` guards in the migrations produce.
  if (pgCode === "42501" || /permission denied|not permitted/i.test(err?.message ?? "")) {
    return fail("forbidden", "You don't have permission to do that.");
  }
  if (pgCode === "28000") {
    return fail("unauthenticated", "Your session has expired. Please sign in again.");
  }
  if (pgCode === "23505") {
    return fail("conflict", "That record already exists.");
  }
  if (pgCode === "23503") {
    return fail("invalid_request", "That refers to something that doesn't exist.");
  }
  if (pgCode === "23514" || pgCode === "23502") {
    return fail("invalid_request", "Some of the values sent aren't valid.");
  }
  return fail("upstream_error", `The request could not be completed. Reference: ${ref}`);
}

/** Restricts a handler to one HTTP method. */
export function methodGuard(req: Request, ...allowed: string[]): Response | null {
  if (allowed.includes(req.method)) return null;
  return fail("invalid_request", `Method ${req.method} not allowed.`, {
    allow: allowed.join(", "),
  });
}

/** Parses a JSON body, bounded so a huge payload can't be used to burn CPU. */
export async function readJson<T = Record<string, unknown>>(
  req: Request,
  maxBytes = 256 * 1024
): Promise<T | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    if (!text) return {} as T;
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** Best-effort client identity for rate limiting. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
