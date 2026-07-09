/**
 * Pure builder for the SL closes backup sheet (PLAN.md §18a): one row per
 * close slot with capacity, claim counts, and claimant names. Mirrors the
 * responses export split (`admin/export.ts` pure builder + server loader);
 * `admin/sheet-sync.ts` feeds it `loadCloseAdmin()` slots.
 */
import { formatTime } from "@/lib/domain/time";
import { remainingCapacity, type CloseSlotKind } from "@/lib/domain/close-claims";

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

const KIND_LABEL: Record<CloseSlotKind, string> = { fri: "Fri", sat: "Sat" };

/** Build the closes matrix: header row + one row per slot. */
export function buildCloseClaimsMatrix(slots: readonly CloseExportSlot[]): string[][] {
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
  return matrix;
}
