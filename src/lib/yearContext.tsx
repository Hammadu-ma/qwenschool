import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { callRpc } from "./http";

/**
 * The academic year is the axis the whole system turns on.
 *
 * After 0021_year_scope.sql every record in the database carries a year_id.
 * This context holds the ONE year the user is currently looking at, and every
 * query key in api.ts includes it. Two consequences fall out of that:
 *
 *   1. Switching years is instant and total. Change it here and every list,
 *      dashboard, report and register in the app re-reads for that year —
 *      because the query key changed, not because each page remembered to
 *      re-filter. Pages cannot accidentally show a mix of years.
 *
 *   2. Nothing ever loads "all history". A query for 2024/25 attendance can
 *      never touch 2019/20 rows, so the working set stays the same size in
 *      year ten as it was in year one.
 *
 * The selection is remembered per user in sessionStorage. It defaults to the
 * school's active year and always falls back to it if the remembered year no
 * longer exists (deleted, or a different school).
 */

export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  status?: "planned" | "open" | "closed";
}

interface YearContextValue {
  /** The year every query in the app is currently scoped to. */
  yearId: string | null;
  year: AcademicYear | null;
  years: AcademicYear[];
  /** The school's active year, regardless of what the user is viewing. */
  activeYearId: string | null;
  /** True when viewing a year that is closed or simply not the active one. */
  isHistorical: boolean;
  isReadOnly: boolean;
  setYearId: (id: string) => void;
  loading: boolean;
}

const YearContext = createContext<YearContextValue | null>(null);

const STORAGE_KEY = "riverside.selected-year";

export function AcademicYearProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  // The year list is small (one row per school year, ever) and changes about
  // once a year, so it is fetched once and kept.
  const { data: years = [], isLoading } = useQuery({
    queryKey: ["academic-years"],
    enabled: true,
    queryFn: async (): Promise<AcademicYear[]> => {
      // Comes from get_reference(), which the API publishes — there is no
      // direct table read from the browser any more.
      const ref = await callRpc<{ years: AcademicYear[] }>("get_reference", {});
      return ref?.years ?? [];
    },
  });

  const activeYearId = useMemo(
    () => years.find((y) => y.is_active)?.id ?? years[0]?.id ?? null,
    [years]
  );

  // Fall back to the active year whenever the remembered selection is gone.
  const yearId = useMemo(() => {
    if (selected && years.some((y) => y.id === selected)) return selected;
    return activeYearId;
  }, [selected, years, activeYearId]);

  useEffect(() => {
    if (!yearId) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, yearId);
    } catch {
      /* storage unavailable — the selection just won't survive a reload */
    }
  }, [yearId]);

  const value = useMemo<YearContextValue>(() => {
    const year = years.find((y) => y.id === yearId) ?? null;
    return {
      yearId,
      year,
      years,
      activeYearId,
      isHistorical: Boolean(yearId && activeYearId && yearId !== activeYearId),
      isReadOnly: year?.status === "closed",
      loading: isLoading,
      setYearId: (id: string) => {
        if (id === yearId) return;
        setSelected(id);
        // Drop every year-scoped cache entry so no page can render last
        // year's numbers under this year's heading for even one frame.
        qc.removeQueries({
          predicate: (q) => Array.isArray(q.queryKey) && q.queryKey.includes(yearId ?? ""),
        });
      },
    };
  }, [yearId, years, activeYearId, isLoading, qc]);

  return <YearContext.Provider value={value}>{children}</YearContext.Provider>;
}

export function useAcademicYear(): YearContextValue {
  const ctx = useContext(YearContext);
  if (!ctx) {
    throw new Error("useAcademicYear must be used inside <AcademicYearProvider>");
  }
  return ctx;
}

/**
 * Convenience for the common case: the year id, guaranteed non-null, for use
 * inside a component that only renders once the year has resolved.
 */
export function useYearId(): string {
  const { yearId } = useAcademicYear();
  return yearId ?? "";
}
