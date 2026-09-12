/**
 * Pure response-list filters that follow you (PLAN §10, roadmap 2.2).
 *
 * The group, position, flag, off-roster, and submission-state filters live in the URL so they
 * survive navigation into the per-student view and drive the prev/next walk there. This
 * module owns the parse ↔ apply ↔ serialize round-trip; `admin/data.ts` fetches
 * the rows and the pages read/write the query. Search + sort stay client-side in
 * the list table.
 */
import { matchesStarted, type StartedMode } from "@/lib/domain/calendar-day";
import type { DbFlagType } from "@/lib/db/schema";

/** A flag filter: "any" = at least one flag, or a specific flag type. */
export type FlagFilter = "any" | DbFlagType;

/**
 * The admin's own progress through the pile: a submission they haven't marked
 * scheduled yet is still on the desk. Drafts are nobody's to review, so neither
 * value matches them.
 */
export type ReviewFilter = "todo" | "done";

/**
 * Which submission states the list shows. Absent is the default view: the
 * responses, submitted and draft alike, with the students who never started one
 * hidden. "all" is everyone including those.
 */
export type StatusFilter = "submitted" | "draft" | "missing" | "all";

export interface ResponseFilters {
  /** A group id, or "none" for responders with no group. */
  groupId?: string | "none";
  /** A position id, or "none" for responders with no position assigned. */
  positionId?: string | "none";
  /** Restrict to responders carrying a matching flag. */
  flag?: FlagFilter;
  /** Also list off-roster responders (hidden by default). */
  includeOffRoster?: boolean;
  /** Restrict by submission state; absent shows the responses and hides the rest. */
  status?: StatusFilter;
  /** Restrict by roster start date (`date` is `yyyy-mm-dd`). Rows with no
   *  recorded start date never match while this is set. */
  started?: { mode: StartedMode; date: string };
  /** Restrict to submitted responses by whether they're marked scheduled. */
  review?: ReviewFilter;
}

/** The minimal row shape the filters read. */
export interface FilterableResponse {
  groupId: string | null;
  positionId: string | null;
  flagTypes: DbFlagType[];
  onRoster: boolean;
  hiredOn: Date | null;
  /** "missing" = a roster student with no submission row at all. */
  status: "draft" | "submitted" | "missing";
  scheduled: boolean;
}

/** Short human label per flag type, shared by the filter dropdown and the pills. */
export const FLAG_LABELS: Record<DbFlagType, string> = {
  auto_assigned_weekend: "Auto-assigned weekend",
  travel_late: "Late travel",
  position_change: "Position changed",
  revalidation_failed: "Failed validation",
  student_changed_after_internal_edit: "Changed after adjustment",
  orphaned_selection: "Unavailable pick",
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

/** Sentinel position value for responders with no position assigned. */
export const NO_POSITION = "none";

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

/** Options for the submission-state dropdown (value "" = the default view). */
export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Responses" },
  { value: "submitted", label: "Submitted" },
  { value: "draft", label: "Drafts" },
  { value: "missing", label: "No submission" },
  { value: "all", label: "Everyone" },
];

const STATUS_FILTERS: readonly StatusFilter[] = ["submitted", "draft", "missing", "all"];

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Read filters from raw query params (unknown/absent values are dropped). */
export function parseResponseFilters(params: {
  group?: string;
  position?: string;
  flag?: string;
  roster?: string;
  status?: string;
  all?: string;
  started?: string;
  startedDate?: string;
  review?: string;
}): ResponseFilters {
  const filters: ResponseFilters = {};
  const group = params.group?.trim();
  if (group && group !== "all") filters.groupId = group;
  const position = params.position?.trim();
  if (position && position !== "all") filters.positionId = position;
  const flag = params.flag?.trim();
  if (flag && (KNOWN_FLAGS as readonly string[]).includes(flag)) {
    filters.flag = flag as FlagFilter;
  }
  if (params.roster?.trim() === "all") filters.includeOffRoster = true;
  const status = params.status?.trim();
  if (status && (STATUS_FILTERS as readonly string[]).includes(status)) {
    filters.status = status as StatusFilter;
  } else if (params.all?.trim() === "1") {
    // `all=1` was the old show-everyone switch; saved links keep working.
    filters.status = "all";
  }
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
    // With no state chosen the dashboard stays a list of responses, so students
    // who never started one are out; otherwise the chosen state decides.
    if (filters.status === undefined) {
      if (r.status === "missing") return false;
    } else if (filters.status !== "all" && r.status !== filters.status) {
      return false;
    }
    if (filters.groupId === UNGROUPED) {
      if (r.groupId !== null) return false;
    } else if (filters.groupId && r.groupId !== filters.groupId) {
      return false;
    }
    if (filters.positionId === NO_POSITION) {
      if (r.positionId !== null) return false;
    } else if (filters.positionId && r.positionId !== filters.positionId) {
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

/**
 * The filters the per-student prev/next walk falls back to when the active ones
 * hide the student being viewed (`getResponseNeighbors`).
 *
 * Off-roster is a visibility switch, not a question about the data, so it
 * always widens: the open student is on screen either way. A submission state
 * the admin CHOSE is a real restriction, and widening it away would have the
 * arrows walk a list the dashboard never showed. So an explicit state is kept,
 * and a student outside it gets no arrows, exactly as the review filter already
 * behaves. With no state chosen the default view is "the responses", which is a
 * default rather than a choice, so a student who never started one still walks.
 */
export function neighborFallbackFilters(filters: ResponseFilters): ResponseFilters {
  return {
    ...filters,
    ...(filters.status === undefined ? { status: "all" as const } : {}),
    includeOffRoster: true,
  };
}

/** Serialize to a query string (no leading "?"); empty when no filters are set. */
export function serializeResponseFilters(filters: ResponseFilters): string {
  const params = new URLSearchParams();
  if (filters.groupId) params.set("group", filters.groupId);
  if (filters.positionId) params.set("position", filters.positionId);
  if (filters.flag) params.set("flag", filters.flag);
  if (filters.includeOffRoster) params.set("roster", "all");
  // Always the new param, never the `all=1` alias the parser still reads.
  if (filters.status) params.set("status", filters.status);
  if (filters.started) {
    params.set("started", filters.started.mode);
    params.set("startedDate", filters.started.date);
  }
  if (filters.review) params.set("review", filters.review);
  return params.toString();
}
