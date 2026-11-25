/**
 * Pure builder for the SL closes backup sheet (PLAN.md §18a): one row per
 * close slot with capacity, claim counts, and claimant names, then one row per
 * Shift Lead with how many closes they owe and hold. Mirrors the
 * responses export split (`admin/export.ts` pure builder + server loader);
 * `admin/sheet-sync.ts` feeds it `loadCloseAdmin()` slots.
 */
import { formatTime } from "@/lib/domain/time";
import {
  remainingCapacity,
  type CloseLeadStatus,
  type CloseSlotKind,
} from "@/lib/domain/close-claims";

export interface CloseExportSlot {
  date: string;
  kind: CloseSlotKind;
  startMinutes: number;
  endMinutes: number;
  capacity: number;
  claimants: { displayName: string; email: string }[];
}

export const CLOSE_EXPORT_HEADERS = [
  "Date",
  "Day",
  "Time",
  "Capacity",
  "Claimed",
  "Open",
  "Claimed by",
] as const;

export interface CloseExportLead {
  displayName: string;
  email: string;
  required: number;
  claimCount: number;
  status: CloseLeadStatus;
}

export const CLOSE_LEAD_HEADERS = ["Shift Lead", "Email", "Required", "Picked", "Status"] as const;

const KIND_LABEL: Record<CloseSlotKind, string> = { fri: "Fri", sat: "Sat" };
const STATUS_LABEL: Record<CloseLeadStatus, string> = { short: "Short", done: "Done", over: "Over" };

/**
 * Build the closes matrix: header row + one row per slot. With leads, a blank
 * row and a second table follow: one row per lead with their required number.
 */
export function buildCloseClaimsMatrix(
  slots: readonly CloseExportSlot[],
  leads: readonly CloseExportLead[] = [],
): string[][] {
  const matrix: string[][] = [[...CLOSE_EXPORT_HEADERS]];
  for (const s of slots) {
    matrix.push([
      s.date,
      KIND_LABEL[s.kind],
      `${formatTime(s.startMinutes)}–${formatTime(s.endMinutes)}`,
      String(s.capacity),
      String(s.claimants.length),
      String(remainingCapacity(s.capacity, s.claimants.length)),
      s.claimants.map((c) => `${c.displayName} <${c.email}>`).join("; "),
    ]);
  }
  if (leads.length > 0) {
    matrix.push([], [...CLOSE_LEAD_HEADERS]);
    for (const l of leads) {
      matrix.push([
        l.displayName,
        l.email,
        String(l.required),
        String(l.claimCount),
        STATUS_LABEL[l.status],
      ]);
    }
  }
  return matrix;
}
