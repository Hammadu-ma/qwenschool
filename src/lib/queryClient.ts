import { QueryClient } from "@tanstack/react-query";

/**
 * Replaces the old hand-rolled `dbCache.ts` (one giant localStorage blob) and
 * the manual `loadedGroupsRef`/`loadingGroupsRef`/`loadedGroupsTick` dedup
 * logic that used to live in store.tsx. TanStack Query now owns:
 *   - request dedup (two components mounting the same query key in the same
 *     tick only fire one fetch)
 *   - per-query-key caching (core and each lazy group live independently in
 *     memory, instead of one JSON blob that had to be merged by hand on
 *     every boot — see the old `mergeCoreIntoCached`)
 *   - stale-while-revalidate semantics via `staleTime`
 *
 * IMPORTANT: this cache is in-memory only, for the lifetime of the tab. It
 * is deliberately NOT persisted to localStorage/IndexedDB — school records
 * (students, marks, fees, messages…) should never sit in browser storage
 * as an offline copy. Every fresh tab / hard reload re-hydrates straight
 * from Supabase, with RLS deciding what this session's user may see, same
 * as any other request. staleTime is Infinity because that re-fetch on
 * mount is enough — nothing here needs to re-poll on a timer or on window
 * refocus, it just shouldn't survive the tab closing.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

/** Wipes the in-memory query cache — used on logout, so the next sign-in
 *  (possibly a different user) can't read a moment of the previous
 *  session's data out of a stale cache entry. Also clears the localStorage
 *  key an older build of this app used to persist the cache under, so
 *  anyone upgrading from that build doesn't keep carrying a stale offline
 *  copy of school data around in their browser. */
const LEGACY_STORAGE_KEY = "riverside.query-cache.v1";

// One-time cleanup on load, not just on logout — someone upgrading from the
// old persisted-cache build has that key sitting in localStorage right now,
// independent of whether/when they next log out.
try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }

export function clearPersistedCache() {
  queryClient.clear();
  try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }
}
