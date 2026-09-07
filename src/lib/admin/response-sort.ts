/**
 * The response list's sort order, as a pure round-trip like its filters
 * (`./response-filters.ts`).
 *
 * The sort used to be client-only state inside the table, which meant it stopped
 * at the row you clicked: the per-student view's prev/next walk and its jump
 * dropdown were always in name order, so "next" could be a student nowhere near
 * the one under the cursor in the list you were actually reading. Putting the
 * order in the URL alongside the filters lets the server walk the same list the
 * admin is looking at, and lets both sides share one comparator rather than
 * keeping two in step by hand.
 */

export type SortKey =
  | "name"
  | "group"
  | "position"
  | "status"
  | "requested"
  | "flags"
  | "scheduled"
  | "updated";

/** 1 ascending, -1 descending. */
export type SortDir = 1 | -1;

export interface ResponseSort {
  key: SortKey;
  dir: SortDir;
}

export const SORT_KEYS: readonly SortKey[] = [
  "name",
  "group",
  "position",
  "status",
  "requested",
  "flags",
  "scheduled",
  "updated",
];

/** Name ascending, which is also the order the list query already returns. */
export const DEFAULT_SORT: ResponseSort = { key: "name", dir: 1 };

export const isDefaultSort = (sort: ResponseSort) =>
  sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir;

/** The minimal row shape the comparator reads. */
export interface SortableResponse {
  displayName: string;
  /** Null for an ungrouped student, who sorts after every named group. */
  groupName: string | null;
  positionName: string | null;
  status: string;
  desiredHours: number | null;
  flagCount: number;
  scheduled: boolean;
  submittedAt: Date | null;
  updatedAt: Date | null;
}

const stamp = (r: SortableResponse) => (r.submittedAt ?? r.updatedAt)?.getTime() ?? 0;

export function compareResponses(a: SortableResponse, b: SortableResponse, key: SortKey): number {
  switch (key) {
    case "name":
      return a.displayName.localeCompare(b.displayName);
    case "group":
      // Ungrouped students sort last rather than first: the list leads with the
      // groups an admin is working through, and "no group" is the tail.
      return (a.groupName ?? "￿").localeCompare(b.groupName ?? "￿");
    case "position":
      return (a.positionName ?? "").localeCompare(b.positionName ?? "");
    case "status":
      return a.status.localeCompare(b.status);
    case "requested":
      return (a.desiredHours ?? 0) - (b.desiredHours ?? 0);
    case "flags":
      return a.flagCount - b.flagCount;
    case "scheduled":
      return Number(a.scheduled) - Number(b.scheduled);
    case "updated":
      // Students with no submission have no date; they sort to the top.
      return stamp(a) - stamp(b);
  }
}

/**
 * Sorted copy. Ties break on name so the order is total: without it two students
 * with the same flag count could swap places between the list and the walk, and
 * "next" would not be the row underneath.
 */
export function sortResponses<T extends SortableResponse>(
  rows: readonly T[],
  sort: ResponseSort,
): T[] {
  return [...rows].sort((a, b) => {
    const by = sort.dir * compareResponses(a, b, sort.key);
    return by !== 0 ? by : a.displayName.localeCompare(b.displayName);
  });
}

/** Read the sort from raw query params; anything unknown falls back to the default. */
export function parseResponseSort(params: { sort?: string; dir?: string }): ResponseSort {
  const key = params.sort?.trim();
  return {
    key:
      key && (SORT_KEYS as readonly string[]).includes(key) ? (key as SortKey) : DEFAULT_SORT.key,
    dir: params.dir?.trim() === "desc" ? -1 : 1,
  };
}

/** Serialize to a query string (no leading "?"); empty while the sort is the default. */
export function serializeResponseSort(sort: ResponseSort): string {
  if (isDefaultSort(sort)) return "";
  const params = new URLSearchParams();
  params.set("sort", sort.key);
  if (sort.dir === -1) params.set("dir", "desc");
  return params.toString();
}

/** Join the filter and sort query strings, dropping whichever is empty. */
export function joinQuery(...parts: string[]): string {
  return parts.filter(Boolean).join("&");
}
