/**
 * Pure rules for the Shift-Lead weekend-close claim subsystem (PLAN.md §18a).
 *
 * Unlike the templated availability blocks (§6), closes are a real dated
 * inventory: one slot per Friday/Saturday of the semester, each with finite
 * capacity, claimed first-come-first-served. Each Shift Lead owes their own
 * number of closes for the term: the term's default when they became a lead,
 * unless an admin set another. This module is pure (dates are YYYY-MM-DD
 * strings, all math in UTC); the atomic claim write lives in the server layer.
 */
import { formatTime, parseTime } from "./time";

/** The most closes one lead can be asked for. Zero means none are asked. */
export const MAX_CLOSE_REQUIREMENT = 20;

/** A whole number from 0 to the maximum. */
export function isValidCloseRequirement(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_CLOSE_REQUIREMENT;
}

/** The close shift runs 6p to 11:30p (stored per slot; these seed new slots). */
export const CLOSE_START_MINUTES = parseTime("6p");
export const CLOSE_END_MINUTES = parseTime("11:30p");

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

/**
 * Whether a Shift Lead has finished picking: they hold at least their number.
 * "At least" and not "exactly", so lowering a lead's number never leaves them
 * stuck holding too many.
 */
export function closeClaimsComplete(claimCount: number, required: number): boolean {
  return claimCount >= required;
}

/** Whether a lead may take one more close. They can hold their number, and no more. */
export function canClaimAnotherClose(claimCount: number, required: number): boolean {
  return claimCount < required;
}

/** Whether the closes step is shown to a lead at all. A number of 0 hides it. */
export function closeStepApplies(required: number): boolean {
  return required > 0;
}

export type CloseLeadStatus = "short" | "done" | "over";

/** Where a lead stands against their number. */
export function closeLeadStatus(claimCount: number, required: number): CloseLeadStatus {
  if (claimCount < required) return "short";
  return claimCount > required ? "over" : "done";
}

/** The status as an admin reads it: "Short by 2", "Done", "Over by 1". */
export function closeLeadStatusLabel(claimCount: number, required: number): string {
  const status = closeLeadStatus(claimCount, required);
  if (status === "done") return "Done";
  const by = Math.abs(required - claimCount);
  return status === "short" ? `Short by ${by}` : `Over by ${by}`;
}

export type CloseSlotFill =
  | { state: "open"; count: number }
  | { state: "full" }
  | { state: "over"; count: number };

/** How full one close is: spots still open, exactly full, or more leads than spots. */
export function closeSlotFill(capacity: number, claimedCount: number): CloseSlotFill {
  if (claimedCount > capacity) return { state: "over", count: claimedCount - capacity };
  if (claimedCount === capacity) return { state: "full" };
  return { state: "open", count: capacity - claimedCount };
}

export interface CloseWeekend<T> {
  /** The Friday's date, whether or not that Friday has a close. */
  key: string;
  fri: T | null;
  sat: T | null;
}

export interface CloseMonth<T> {
  /** "YYYY-MM" of the weekend's Friday. */
  key: string;
  /** "November 2026". The year is shown so one year never passes for another. */
  label: string;
  weekends: CloseWeekend<T>[];
}

/**
 * Closes laid out for the admin page: Friday and Saturday of one weekend side
 * by side, weekends in date order under their month. A weekend belongs to the
 * month of its Friday, so a Saturday on the 1st stays with the Friday before.
 */
export function groupCloseWeekends<T extends CloseSlotDate>(slots: readonly T[]): CloseMonth<T>[] {
  const weekends = new Map<string, CloseWeekend<T>>();
  for (const slot of slots) {
    const key = closeWeekendKey(slot.date, slot.kind);
    const weekend = weekends.get(key) ?? { key, fri: null, sat: null };
    weekend[slot.kind] = slot;
    weekends.set(key, weekend);
  }
  const months: CloseMonth<T>[] = [];
  for (const weekend of [...weekends.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const key = weekend.key.slice(0, 7);
    let month = months[months.length - 1];
    if (!month || month.key !== key) {
      const d = toUtc(weekend.key);
      month = { key, label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`, weekends: [] };
      months.push(month);
    }
    month.weekends.push(weekend);
  }
  return months;
}

export interface CloseFeasibility {
  /** Seats needed: every active Shift Lead's own number, added up. */
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
  /** Each active lead's required number. */
  requirements: readonly number[];
}): CloseFeasibility {
  const required = input.requirements.reduce((sum, n) => sum + n, 0);
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** A slot date without its year, e.g. "Fri Sep 4", for use under a heading that carries it. */
export function formatCloseDay(iso: string): string {
  const d = toUtc(iso);
  return `${DAY_LABELS[d.getUTCDay()]} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Short human label for a slot date, e.g. "Fri Sep 4, 2026". The year is shown
 * so a slot from another year can never pass for this one.
 */
export function formatCloseDate(iso: string): string {
  const d = toUtc(iso);
  return `${DAY_LABELS[d.getUTCDay()]} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** One-line label for a whole slot, e.g. "Fri Sep 4, 2026, 6p–11:30p". */
export function formatCloseSlot(slot: {
  date: string;
  startMinutes: number;
  endMinutes: number;
}): string {
  return `${formatCloseDate(slot.date)}, ${formatTime(slot.startMinutes)}–${formatTime(slot.endMinutes)}`;
}
