/**
 * Pure response-list filters that follow you (PLAN §10, roadmap 2.2).
 *
 * The group, flag, and off-roster filters live in the URL so they survive
 * navigation into the per-student view and drive the prev/next walk there. This
 * module owns the parse ↔ apply ↔ serialize round-trip; `admin/data.ts` fetches
 * the rows and the pages read/write the query. Search + sort stay client-side in
 * the list table.
 */
import type { DbFlagType } from "@/lib/db/schema";

/** A flag filter: "any" = at least one flag, or a specific flag type. */
export type FlagFilter = "any" | DbFlagType;

/** How a start-date filter compares against the roster hire date. */
export type StartedMode = "before" | "after" | "on";

/**
 * The admin's own progress through the pile: a submission they haven't marked
 * scheduled yet is still on the desk. Drafts are nobody's to review, so neither
 * value matches them.
 */
export type ReviewFilter = "todo" | "done";

export interface ResponseFilters {
  /** A group id, or "none" for responders with no group. */
  groupId?: string | "none";
  /** Restrict to responders carrying a matching flag. */
  flag?: FlagFilter;
  /** Also list off-roster responders (hidden by default). */
  includeOffRoster?: boolean;
  /** Restrict by roster start date (`date` is `yyyy-mm-dd`). Rows with no
   *  recorded start date never match while this is set. */
  started?: { mode: StartedMode; date: string };
  /** Restrict to submitted responses by whether they're marked scheduled. */
  review?: ReviewFilter;
}

/** The minimal row shape the filters read. */
export interface FilterableResponse {
  groupId: string | null;
  flagTypes: DbFlagType[];
  onRoster: boolean;
  hiredOn: Date | null;
  status: "draft" | "submitted";
  scheduled: boolean;
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

/** Options for the start-date mode dropdown (value "" = no filter). */
export const STARTED_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any time" },
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "on", label: "On" },
];

const STARTED_MODES: readonly StartedMode[] = ["before", "after", "on"];

/** Options for the review dropdown (value "" = no filter). */
export const REVIEW_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "todo", label: "To review" },
  { value: "done", label: "Reviewed" },
];

const REVIEW_FILTERS: readonly ReviewFilter[] = ["todo", "done"];

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Read filters from raw query params (unknown/absent values are dropped). */
export function parseResponseFilters(params: {
  group?: string;
  flag?: string;
  roster?: string;
  started?: string;
  startedDate?: string;
  review?: string;
}): ResponseFilters {
  const filters: ResponseFilters = {};
  const group = params.group?.trim();
  if (group && group !== "all") filters.groupId = group;
  const flag = params.flag?.trim();
  if (flag && (KNOWN_FLAGS as readonly string[]).includes(flag)) {
    filters.flag = flag as FlagFilter;
  }
  if (params.roster?.trim() === "all") filters.includeOffRoster = true;
  const mode = params.started?.trim();
  const date = params.startedDate?.trim();
  if (mode && date && (STARTED_MODES as readonly string[]).includes(mode) && isIsoDate(date)) {
    filters.started = { mode: mode as StartedMode, date };
  }
  const review = params.review?.trim();
  if (review && (REVIEW_FILTERS as readonly string[]).includes(review)) {
    filters.review = review as ReviewFilter;
  }
  return filters;
}

/** Keep only the rows matching the active filters (order preserved). */
export function applyResponseFilters<T extends FilterableResponse>(
  rows: T[],
  filters: ResponseFilters,
): T[] {
  return rows.filter((r) => {
    // Responders who have since moved to "People Leaving" (PLAN §4.2) stay
    // hidden unless the off-roster switch is on; their submission is retained.
    if (!r.onRoster && !filters.includeOffRoster) return false;
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
    if (filters.started && !matchesStarted(r.hiredOn, filters.started)) return false;
    // A draft isn't reviewable, so it matches neither side of the review filter.
    if (filters.review === "todo" && !(r.status === "submitted" && !r.scheduled)) return false;
    if (filters.review === "done" && !(r.status === "submitted" && r.scheduled)) return false;
    return true;
  });
}

/** Calendar-day comparison against the roster start date (ISO strings sort). */
function matchesStarted(
  hiredOn: Date | null,
  started: { mode: StartedMode; date: string },
): boolean {
  if (!hiredOn) return false;
  const day = hiredOn.toISOString().slice(0, 10);
  switch (started.mode) {
    case "before":
      return day < started.date;
    case "after":
      return day > started.date;
    case "on":
      return day === started.date;
  }
}

/** Serialize to a query string (no leading "?"); empty when no filters are set. */
export function serializeResponseFilters(filters: ResponseFilters): string {
  const params = new URLSearchParams();
  if (filters.groupId) params.set("group", filters.groupId);
  if (filters.flag) params.set("flag", filters.flag);
  if (filters.includeOffRoster) params.set("roster", "all");
  if (filters.started) {
    params.set("started", filters.started.mode);
    params.set("startedDate", filters.started.date);
  }
  if (filters.review) params.set("review", filters.review);
  return params.toString();
}
