/**
 * Pure rules for the Shift-Lead weekend-close claim subsystem (PLAN.md §18a).
 *
 * Unlike the templated availability blocks (§6), closes are a real dated
 * inventory: one slot per Friday/Saturday of the semester, each with finite
 * capacity, claimed first-come-first-served. Every Shift Lead must hold
 * exactly REQUIRED_CLOSE_CLAIMS for the semester. This module is pure (dates
 * are YYYY-MM-DD strings, all math in UTC); the atomic claim write lives in
 * the server layer.
 */
import { formatTime, parseTime } from "./time";

/** Every Shift Lead must claim exactly this many closes (PLAN §18a). */
export const REQUIRED_CLOSE_CLAIMS = 3;

/** The close shift runs 6p to 11:30p (stored per slot; these seed new slots). */
export const CLOSE_START_MINUTES = parseTime("6p");
export const CLOSE_END_MINUTES = parseTime("11:30p");

/** The position whose form includes the close-picking step. */
export const SHIFT_LEAD_POSITION_ID = "shift-lead";

export type CloseSlotKind = "fri" | "sat";

export interface CloseSlotDate {
  date: string;
  kind: CloseSlotKind;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FRIDAY = 5; // Date.getUTCDay()
const SATURDAY = 6;

const toUtc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date): string => d.toISOString().slice(0, 10);

/** The first Friday of a month, as a UTC Date. */
function firstFriday(year: number, month: number): Date {
  const d = new Date(Date.UTC(year, month, 1));
  const offset = (FRIDAY - d.getUTCDay() + 7) % 7;
  return new Date(d.getTime() + offset * DAY_MS);
}

/**
 * The default fall inventory range for the year of `now` (PLAN §18a): the
 * first September weekend (its Friday) through the second December weekend
 * (its Saturday). A default for the admin form, not a constraint.
 */
export function defaultCloseSemesterRange(now: Date): { start: string; end: string } {
  const year = now.getUTCFullYear();
  const start = firstFriday(year, 8);
  const secondDecFriday = new Date(firstFriday(year, 11).getTime() + 7 * DAY_MS);
  return { start: toIso(start), end: toIso(new Date(secondDecFriday.getTime() + DAY_MS)) };
}

/** Every Friday and Saturday date in [start, end], in order. */
export function generateCloseSlotDates(startIso: string, endIso: string): CloseSlotDate[] {
  const out: CloseSlotDate[] = [];
  const end = toUtc(endIso).getTime();
  for (let t = toUtc(startIso).getTime(); t <= end; t += DAY_MS) {
    const day = new Date(t).getUTCDay();
    if (day === FRIDAY) out.push({ date: toIso(new Date(t)), kind: "fri" });
    else if (day === SATURDAY) out.push({ date: toIso(new Date(t)), kind: "sat" });
  }
  return out;
}

/** Group key for a slot's weekend: the Friday's date (a Saturday joins the day before). */
export function closeWeekendKey(date: string, kind: CloseSlotKind): string {
  return kind === "fri" ? date : toIso(new Date(toUtc(date).getTime() - DAY_MS));
}

/** Seats still open on a slot; never negative. */
export function remainingCapacity(capacity: number, claimedCount: number): number {
  return Math.max(0, capacity - claimedCount);
}

/** Whether a Shift Lead has finished picking (holds all required claims). */
export function closeClaimsComplete(claimCount: number): boolean {
  return claimCount >= REQUIRED_CLOSE_CLAIMS;
}

export interface CloseFeasibility {
  /** Seats needed: REQUIRED_CLOSE_CLAIMS per active Shift Lead. */
  required: number;
  /** Seats in the inventory: the sum of every slot's capacity. */
  available: number;
  feasible: boolean;
}

/**
 * Can every Shift Lead get their required claims? Checked when the admin
 * edits the inventory or the roster changes (PLAN §18a); a warning, not a gate.
 */
export function closeClaimsFeasibility(input: {
  totalCapacity: number;
  shiftLeadCount: number;
}): CloseFeasibility {
  const required = input.shiftLeadCount * REQUIRED_CLOSE_CLAIMS;
  return {
    required,
    available: input.totalCapacity,
    feasible: input.totalCapacity >= required,
  };
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Short human label for a slot date, e.g. "Fri Sep 4". */
export function formatCloseDate(iso: string): string {
  const d = toUtc(iso);
  return `${DAY_LABELS[d.getUTCDay()]} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** One-line label for a whole slot, e.g. "Fri Sep 4, 6p–11:30p". */
export function formatCloseSlot(slot: {
  date: string;
  startMinutes: number;
  endMinutes: number;
}): string {
  return `${formatCloseDate(slot.date)}, ${formatTime(slot.startMinutes)}–${formatTime(slot.endMinutes)}`;
}
