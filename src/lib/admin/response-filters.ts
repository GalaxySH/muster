/**
 * Pure response-list filters that follow you (PLAN §10, roadmap 2.2).
 *
 * The group and flag filters live in the URL so they survive navigation into the
 * per-student view and drive the prev/next walk there. This module owns the
 * parse ↔ apply ↔ serialize round-trip; `admin/data.ts` fetches the rows and the
 * pages read/write the query. Search + sort stay client-side in the list table.
 */
import type { DbFlagType } from "@/lib/db/schema";

/** A flag filter: "any" = at least one flag, or a specific flag type. */
export type FlagFilter = "any" | DbFlagType;

export interface ResponseFilters {
  /** A group id, or "none" for on-roster responders with no group. */
  groupId?: string | "none";
  /** Restrict to responders carrying a matching flag. */
  flag?: FlagFilter;
}

/** The minimal row shape the filters read. */
export interface FilterableResponse {
  groupId: string | null;
  flagTypes: DbFlagType[];
}

/** Short human label per flag type, shared by the filter dropdown and the pills. */
export const FLAG_LABELS: Record<DbFlagType, string> = {
  auto_assigned_weekend: "Auto-assigned weekend",
  travel_late: "Late travel",
  position_change: "Position changed",
  revalidation_failed: "Fails validation",
};

const KNOWN_FLAGS: readonly FlagFilter[] = ["any", ...(Object.keys(FLAG_LABELS) as DbFlagType[])];

/** Options for the flag-type dropdown (value "" = no filter). */
export const FLAG_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All responses" },
  { value: "any", label: "Any flag" },
  ...Object.entries(FLAG_LABELS).map(([value, label]) => ({ value, label })),
];

/** Sentinel group value for on-roster responders with no group assigned. */
export const UNGROUPED = "none";

/** Read filters from raw query params (unknown/absent values are dropped). */
export function parseResponseFilters(params: {
  group?: string;
  flag?: string;
}): ResponseFilters {
  const filters: ResponseFilters = {};
  const group = params.group?.trim();
  if (group && group !== "all") filters.groupId = group;
  const flag = params.flag?.trim();
  if (flag && (KNOWN_FLAGS as readonly string[]).includes(flag)) {
    filters.flag = flag as FlagFilter;
  }
  return filters;
}

/** Keep only the rows matching the active filters (order preserved). */
export function applyResponseFilters<T extends FilterableResponse>(
  rows: T[],
  filters: ResponseFilters,
): T[] {
  return rows.filter((r) => {
    if (filters.groupId === UNGROUPED) {
      if (r.groupId !== null) return false;
    } else if (filters.groupId && r.groupId !== filters.groupId) {
      return false;
    }
    if (filters.flag === "any") {
      if (r.flagTypes.length === 0) return false;
    } else if (filters.flag && !r.flagTypes.includes(filters.flag)) {
      return false;
    }
    return true;
  });
}

/** Serialize to a query string (no leading "?"); empty when no filters are set. */
export function serializeResponseFilters(filters: ResponseFilters): string {
  const params = new URLSearchParams();
  if (filters.groupId) params.set("group", filters.groupId);
  if (filters.flag) params.set("flag", filters.flag);
  return params.toString();
}
