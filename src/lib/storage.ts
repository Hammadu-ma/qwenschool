/**
 * Object storage client — Cloudflare R2 via the `r2-storage` Supabase Edge
 * Function (see supabase/functions/r2-storage). The browser never holds an
 * R2 credential: it asks the edge function for a short-lived presigned URL,
 * then talks to R2 directly for the actual PUT/GET.
 *
 * `ownerType` is a generic tag ("student_photo", "student_document", …) that
 * both the edge function and the `file_objects` RLS policies use to decide
 * who can touch a given key — see supabase/migrations/0014_file_storage.sql.
 * Add a new owner type there (one `case` branch) before using it here.
 */
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";

export type FileOwnerType = "student_photo" | "student_document";

/** True once R2 uploads are actually wired up (needs the Supabase project + edge function). */
export const isStorageConfigured = isSupabaseConfigured;

interface UploadResult { url: string; key: string; method: "PUT" }
interface DownloadResult { url: string }

async function invokeStorage<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("File storage needs a connected Supabase project.");
  const { data, error } = await supabase.functions.invoke("r2-storage", { body });
  if (error) throw new Error(error.message ?? "Storage request failed.");
  if (data && typeof data === "object" && "error" in data) throw new Error(String((data as any).error));
  return data as T;
}

/** Uploads a file to R2 and records it in `file_objects`. Returns the storage key. */
export async function uploadFile(opts: {
  file: File;
  ownerType: FileOwnerType;
  ownerId: string;
  kind?: string;
}): Promise<{ key: string; fileId: string | null }> {
  const { file, ownerType, ownerId, kind } = opts;
  if (!supabase) throw new Error("File storage needs a connected Supabase project.");

  const { url, key } = await invokeStorage<UploadResult>({
    action: "presign-upload",
    ownerType,
    ownerId,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
  });

  const put = await fetch(url, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload to storage failed (${put.status}).`);

  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("file_objects")
    .insert({
      owner_type: ownerType,
      owner_id: ownerId,
      storage_key: key,
      original_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      kind: kind ?? null,
      uploaded_by: userData.user?.id ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`File uploaded but metadata save failed: ${error.message}`);

  return { key, fileId: data?.id ?? null };
}

/** Returns a short-lived signed GET URL for a stored object. */
export async function getDownloadUrl(ownerType: FileOwnerType, ownerId: string, key: string): Promise<string> {
  const { url } = await invokeStorage<DownloadResult>({ action: "presign-download", ownerType, ownerId, key });
  return url;
}

/** Same as getDownloadUrl, but inlined as a data: URL (handy for jsPDF / <img> without a visible network flash). */
export async function getDownloadDataUrl(ownerType: FileOwnerType, ownerId: string, key: string): Promise<string> {
  const url = await getDownloadUrl(ownerType, ownerId, key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't fetch file (${res.status}).`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read file."));
    reader.readAsDataURL(blob);
  });
}

/** Deletes the R2 object and its `file_objects` row. `fileId` is optional (only needed if you have it handy). */
export async function deleteFile(ownerType: FileOwnerType, ownerId: string, key: string, fileId?: string | null) {
  await invokeStorage({ action: "delete", ownerType, ownerId, key });
  if (supabase) {
    const q = supabase.from("file_objects").delete();
    await (fileId ? q.eq("id", fileId) : q.eq("storage_key", key));
  }
}

/**
 * Resolves a stored value to something an <img src> can use directly.
 *  - undefined/empty            -> undefined (caller shows a placeholder)
 *  - "data:" / "blob:" / "http" -> returned as-is (legacy inline photo, or a local
 *                                  object-URL preview set while an upload is in flight)
 *  - anything else              -> treated as an R2 key and resolved to a signed URL
 */
export function useSignedUrl(ownerType: FileOwnerType, ownerId: string | undefined, value: string | undefined) {
  const [url, setUrl] = useState<string | undefined>(
    value && /^(data:|blob:|https?:)/.test(value) ? value : undefined,
  );

  useEffect(() => {
    if (!value) { setUrl(undefined); return; }
    if (/^(data:|blob:|https?:)/.test(value)) { setUrl(value); return; }
    if (!ownerId) { setUrl(undefined); return; }

    let cancelled = false;
    getDownloadUrl(ownerType, ownerId, value)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setUrl(undefined); });
    return () => { cancelled = true; };
  }, [ownerType, ownerId, value]);

  return url;
}
