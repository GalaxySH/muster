/**
 * Server-side reads for the SL weekend-close claim subsystem (PLAN.md §18a).
 * Pure rules (required count, capacity, feasibility) live in
 * `domain/close-claims.ts`; this layer only loads and joins. The whole step is
 * dormant until an admin generates a slot inventory (`hasCloseInventory`).
 */
import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { closeClaims, closeSlots, students } from "@/lib/db/schema";
import {
  SHIFT_LEAD_POSITION_ID,
  closeClaimsComplete,
  closeClaimsFeasibility,
  remainingCapacity,
  type CloseFeasibility,
  type CloseSlotKind,
} from "@/lib/domain/close-claims";

export interface CloseSlotView {
  id: string;
  date: string;
  kind: CloseSlotKind;
  startMinutes: number;
  endMinutes: number;
  /** All spots taken. Capacity and claim counts are admin-only and never sent here. */
  full: boolean;
  /** The viewing student holds a claim on this slot. */
  mine: boolean;
}

/**
 * What the student board shows: open/full per slot, never counts or names
 * (PLAN §18a). Counts stay server-side; only admins see them.
 */
export interface CloseBoard {
  slots: CloseSlotView[];
  myClaimCount: number;
}

/** Whether any close slots exist; everything SL-closes stays hidden until they do. */
export async function hasCloseInventory(): Promise<boolean> {
  const [row] = await getDb().select({ n: count() }).from(closeSlots);
  return (row?.n ?? 0) > 0;
}

/** The closes step applies to this student: Shift Lead + a generated inventory. */
export async function isCloseStepRequired(positionId: string | null): Promise<boolean> {
  if (positionId !== SHIFT_LEAD_POSITION_ID) return false;
  return hasCloseInventory();
}

export async function countCloseClaims(email: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(closeClaims)
    .where(eq(closeClaims.studentEmail, email));
  return row?.n ?? 0;
}

export async function loadCloseBoard(email: string): Promise<CloseBoard> {
  const db = getDb();
  const [slots, counts, mine] = await Promise.all([
    db.select().from(closeSlots).orderBy(asc(closeSlots.date)),
    db
      .select({ slotId: closeClaims.closeSlotId, n: count() })
      .from(closeClaims)
      .groupBy(closeClaims.closeSlotId),
    db
      .select({ slotId: closeClaims.closeSlotId })
      .from(closeClaims)
      .where(eq(closeClaims.studentEmail, email)),
  ]);
  const countBySlot = new Map(counts.map((c) => [c.slotId, c.n]));
  const mineSet = new Set(mine.map((m) => m.slotId));
  return {
    slots: slots.map((s) => ({
      id: s.id,
      date: s.date,
      kind: s.kind,
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
      full: remainingCapacity(s.capacity, countBySlot.get(s.id) ?? 0) <= 0,
      mine: mineSet.has(s.id),
    })),
    myClaimCount: mineSet.size,
  };
}

export interface StudentCloseClaims {
  /** The slots this student holds, earliest first. */
  claims: { id: string; date: string; startMinutes: number; endMinutes: number }[];
  complete: boolean;
}

/**
 * One student's claimed closes for the admin per-student view, or null when
 * the step doesn't apply to them (not a Shift Lead, or no inventory yet).
 */
export async function loadStudentCloseClaims(
  email: string,
  positionId: string | null,
): Promise<StudentCloseClaims | null> {
  if (!(await isCloseStepRequired(positionId))) return null;
  const claims = await getDb()
    .select({
      id: closeSlots.id,
      date: closeSlots.date,
      startMinutes: closeSlots.startMinutes,
      endMinutes: closeSlots.endMinutes,
    })
    .from(closeClaims)
    .innerJoin(closeSlots, eq(closeClaims.closeSlotId, closeSlots.id))
    .where(eq(closeClaims.studentEmail, email))
    .orderBy(asc(closeSlots.date));
  return { claims, complete: closeClaimsComplete(claims.length) };
}

export interface CloseClaimant {
  email: string;
  displayName: string;
  claimedAt: Date;
}

export interface AdminCloseSlot {
  id: string;
  date: string;
  kind: CloseSlotKind;
  startMinutes: number;
  endMinutes: number;
  capacity: number;
  claimants: CloseClaimant[];
}

export interface ShiftLeadProgress {
  email: string;
  displayName: string;
  claimCount: number;
  complete: boolean;
}

export interface CloseAdminView {
  slots: AdminCloseSlot[];
  /** Active (on-roster) Shift Leads and how far along their picks are. */
  leads: ShiftLeadProgress[];
  feasibility: CloseFeasibility;
}

export async function loadCloseAdmin(): Promise<CloseAdminView> {
  const db = getDb();
  const [slots, claims, leadRows] = await Promise.all([
    db.select().from(closeSlots).orderBy(asc(closeSlots.date)),
    db
      .select({
        slotId: closeClaims.closeSlotId,
        email: closeClaims.studentEmail,
        displayName: students.displayName,
        claimedAt: closeClaims.claimedAt,
      })
      .from(closeClaims)
      .innerJoin(students, eq(closeClaims.studentEmail, students.email))
      .orderBy(asc(closeClaims.claimedAt)),
    db
      .select({ email: students.email, displayName: students.displayName })
      .from(students)
      .where(and(eq(students.positionId, SHIFT_LEAD_POSITION_ID), eq(students.onRoster, true)))
      .orderBy(asc(students.displayName), asc(students.email)),
  ]);

  const claimantsBySlot = new Map<string, CloseClaimant[]>();
  const countByEmail = new Map<string, number>();
  for (const c of claims) {
    const list = claimantsBySlot.get(c.slotId) ?? [];
    list.push({ email: c.email, displayName: c.displayName, claimedAt: c.claimedAt });
    claimantsBySlot.set(c.slotId, list);
    countByEmail.set(c.email, (countByEmail.get(c.email) ?? 0) + 1);
  }

  return {
    slots: slots.map((s) => ({
      id: s.id,
      date: s.date,
      kind: s.kind,
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
      capacity: s.capacity,
      claimants: claimantsBySlot.get(s.id) ?? [],
    })),
    leads: leadRows.map((l) => {
      const claimCount = countByEmail.get(l.email) ?? 0;
      return { ...l, claimCount, complete: closeClaimsComplete(claimCount) };
    }),
    feasibility: closeClaimsFeasibility({
      totalCapacity: slots.reduce((n, s) => n + s.capacity, 0),
      shiftLeadCount: leadRows.length,
    }),
  };
}
