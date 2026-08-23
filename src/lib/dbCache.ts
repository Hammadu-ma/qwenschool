import type { DB } from "../types";

/**
 * Caches the last successfully-hydrated live snapshot in localStorage so the
 * app can paint immediately on the next open instead of showing a blocking
 * "Connecting…" screen while it re-fetches everything from scratch. The real
 * data is always re-fetched in the background right after — this is purely
 * about not making the person stare at a spinner for data they already had a
 * moment ago.
 */
const KEY = "riverside.cache.v1";

export function loadCachedDb(): DB | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DB;
  } catch {
    return null;
  }
}

export function saveCachedDb(db: DB) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full/blocked — fine, just skip caching */ }
}

export function clearCachedDb() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
