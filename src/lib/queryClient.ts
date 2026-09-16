import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/**
 * Replaces the old hand-rolled `dbCache.ts` (one giant localStorage blob) and
 * the manual `loadedGroupsRef`/`loadingGroupsRef`/`loadedGroupsTick` dedup
 * logic that used to live in store.tsx. TanStack Query now owns:
 *   - request dedup (two components mounting the same query key in the same
 *     tick only fire one fetch)
 *   - per-query-key persistence (core and each lazy group cache/restore
 *     independently, instead of one JSON blob that had to be merged by hand
 *     on every boot — see the old `mergeCoreIntoCached`)
 *   - stale-while-revalidate semantics via `staleTime`
 *
 * staleTime is Infinity everywhere: nothing here is time-based stale data,
 * it's "have we fetched this at all this session" data. Refetching happens
 * explicitly (reconnect(), error-recovery, realtime invalidation later) not
 * on a timer or on window refocus.
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

const STORAGE_KEY = "riverside.query-cache.v1";

export const persister = createSyncStoragePersister({
  key: STORAGE_KEY,
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
});

/** Fully wipes persisted + in-memory cache — used on logout, matching the
 *  old clearCachedDb(). */
export function clearPersistedCache() {
  queryClient.clear();
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
