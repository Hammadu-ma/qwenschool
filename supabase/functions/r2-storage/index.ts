// supabase/functions/r2-storage/index.ts
//
// This is the app's only piece of "serverless backend" for file storage: the
// one place that holds the R2 API credentials and is allowed to sign
// requests against the bucket. The browser never sees those credentials —
// it only ever receives a short-lived, single-object presigned URL.
//
// Authorization is delegated to Postgres: every request is made with the
// caller's own JWT attached, so `supabase.rpc("can_manage_file"/"can_view_file")`
// runs under that user's identity and returns exactly what the RLS policies
// on `file_objects` would allow — one rule, enforced in one place, checked
// from two callers (this function, and Postgres itself).
//
// Deploy:   supabase functions deploy r2-storage
// Secrets:  supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
//             R2_SECRET_ACCESS_KEY=... R2_BUCKET=...
// (SUPABASE_URL and SUPABASE_ANON_KEY are already provided automatically to
// every edge function — you don't set those yourself.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

// back to env lookups
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Add new owner types here as the app grows (staff photos, a school logo, …).
// Keep this list in sync with the `when` branches in the SQL functions.
const ALLOWED_OWNER_TYPES = new Set(["student_photo", "student_document"]);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB safety cap
const URL_TTL_SECONDS = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function slugify(name: string) {
  const trimmed = name.trim().toLowerCase().replace(/[^a-z0-9.\-]+/g, "-").replace(/-+/g, "-");
  return trimmed.slice(-120) || "file";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    return json({ error: "R2 is not configured on the server (missing secrets)." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing Authorization header" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, ownerType, ownerId, key, filename, contentType, size } = body ?? {};
  if (typeof ownerType !== "string" || typeof ownerId !== "string") {
    return json({ error: "ownerType and ownerId are required" }, 400);
  }
  if (!ALLOWED_OWNER_TYPES.has(ownerType)) return json({ error: `Unknown ownerType: ${ownerType}` }, 400);

  // Bound to the CALLER's identity — RLS/RPC checks below are exactly the
  // checks that user's own supabase-js calls would be subject to.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const aws = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: "auto",
    service: "s3",
  });
  const r2Origin = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  // A key always starts with "ownerType/ownerId/…" — this stops a user who
  // is authorized for their OWN owner_id from feeding in a key that belongs
  // to someone else's record of the same owner_type.
  const keyBelongsToOwner = (k: string) => k.startsWith(`${ownerType}/${ownerId}/`);

  try {
    if (action === "presign-upload") {
      if (typeof filename !== "string" || typeof contentType !== "string") {
        return json({ error: "filename and contentType are required" }, 400);
      }
      if (typeof size === "number" && size > MAX_UPLOAD_BYTES) {
        return json({ error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` }, 400);
      }

      const { data: allowed, error } = await supabase.rpc("can_manage_file", {
        p_owner_type: ownerType,
        p_owner_id: ownerId,
      });
      if (error) return json({ error: error.message }, 500);
      if (!allowed) return json({ error: "Forbidden" }, 403);

      const objectKey = `${ownerType}/${ownerId}/${crypto.randomUUID()}-${slugify(filename)}`;
      const url = new URL(`${r2Origin}/${R2_BUCKET}/${objectKey}`);
      url.searchParams.set("X-Amz-Expires", String(URL_TTL_SECONDS));
      const signed = await aws.sign(
        new Request(url, { method: "PUT", headers: { "content-type": contentType } }),
        { aws: { signQuery: true } },
      );
      return json({ url: signed.url, key: objectKey, method: "PUT" });
    }

    if (action === "presign-download") {
      if (typeof key !== "string") return json({ error: "key is required" }, 400);
      if (!keyBelongsToOwner(key)) return json({ error: "Forbidden" }, 403);

      const { data: allowed, error } = await supabase.rpc("can_view_file", {
        p_owner_type: ownerType,
        p_owner_id: ownerId,
      });
      if (error) return json({ error: error.message }, 500);
      if (!allowed) return json({ error: "Forbidden" }, 403);

      const url = new URL(`${r2Origin}/${R2_BUCKET}/${key}`);
      url.searchParams.set("X-Amz-Expires", String(URL_TTL_SECONDS));
      const signed = await aws.sign(new Request(url, { method: "GET" }), { aws: { signQuery: true } });
      return json({ url: signed.url });
    }

    if (action === "delete") {
      if (typeof key !== "string") return json({ error: "key is required" }, 400);
      if (!keyBelongsToOwner(key)) return json({ error: "Forbidden" }, 403);

      const { data: allowed, error } = await supabase.rpc("can_manage_file", {
        p_owner_type: ownerType,
        p_owner_id: ownerId,
      });
      if (error) return json({ error: error.message }, 500);
      if (!allowed) return json({ error: "Forbidden" }, 403);

      const delReq = await aws.sign(
        new Request(`${r2Origin}/${R2_BUCKET}/${key}`, { method: "DELETE" }),
      );
      const res = await fetch(delReq);
      if (!res.ok && res.status !== 404) return json({ error: `R2 delete failed (${res.status})` }, 502);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
