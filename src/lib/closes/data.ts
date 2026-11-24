/**
 * Server-side reads for the SL weekend-close claim subsystem (PLAN.md §18a).
 * Pure rules (required count, capacity, feasibility) live in
 * `domain/close-claims.ts`; this layer only loads and joins. The whole step is
 * dormant until an admin generates a slot inventory (`hasCloseInventory`).
 */
import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { closeClaims, closeSlots, positions, students } from "@/lib/db/schema";
import {
  closeClaimsComplete,
  closeClaimsFeasibility,
  remainingCapacity,
  type CloseFeasibility,
  type CloseSlotKind,
} from "@/lib/domain/close-claims";
import { currentTermId } from "@/lib/terms/current";
import { closeClaimInTerm } from "@/lib/terms/scope";

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

/** Whether the term has any close slots; everything SL-closes stays hidden until it does. */
export async function hasCloseInventory(): Promise<boolean> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(closeSlots)
    .where(eq(closeSlots.termId, await currentTermId()));
  return (row?.n ?? 0) > 0;
}

/**
 * Whether holders of this position pick weekend closes. This flag, not a fixed
 * id or a name, is what makes a position "Shift Lead" to the closes feature.
 */
export async function positionPicksCloses(positionId: string | null): Promise<boolean> {
  if (!positionId) return false;
  const [row] = await getDb()
    .select({ picksCloses: positions.picksCloses })
    .from(positions)
    .where(eq(positions.id, positionId))
    .limit(1);
  return row?.picksCloses ?? false;
}

/** The closes step applies to this student: a closes position + a generated inventory. */
export async function isCloseStepRequired(positionId: string | null): Promise<boolean> {
  if (!(await positionPicksCloses(positionId))) return false;
  return hasCloseInventory();
}

export async function countCloseClaims(email: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(closeClaims)
    .where(and(eq(closeClaims.studentEmail, email), closeClaimInTerm(await currentTermId())));
  return row?.n ?? 0;
}

export async function loadCloseBoard(email: string): Promise<CloseBoard> {
  const db = getDb();
  const termId = await currentTermId();
  const [slots, counts, mine] = await Promise.all([
    db
      .select()
      .from(closeSlots)
      .where(eq(closeSlots.termId, termId))
      .orderBy(asc(closeSlots.date)),
    db
      .select({ slotId: closeClaims.closeSlotId, n: count() })
      .from(closeClaims)
      .groupBy(closeClaims.closeSlotId),
    db
      .select({ slotId: closeClaims.closeSlotId })
      .from(closeClaims)
      .where(and(eq(closeClaims.studentEmail, email), closeClaimInTerm(termId))),
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
    .where(
      and(eq(closeClaims.studentEmail, email), eq(closeSlots.termId, await currentTermId())),
    )
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
  const termId = await currentTermId();
  const [slots, claims, leadRows] = await Promise.all([
    db
      .select()
      .from(closeSlots)
      .where(eq(closeSlots.termId, termId))
      .orderBy(asc(closeSlots.date)),
    db
      .select({
        slotId: closeClaims.closeSlotId,
        email: closeClaims.studentEmail,
        displayName: students.displayName,
        claimedAt: closeClaims.claimedAt,
      })
      .from(closeClaims)
      .innerJoin(students, eq(closeClaims.studentEmail, students.email))
      .where(closeClaimInTerm(termId))
      // The email breaks ties, so two claims in the same second list the same way every time.
      .orderBy(asc(closeClaims.claimedAt), asc(closeClaims.studentEmail)),
    db
      .select({ email: students.email, displayName: students.displayName })
      .from(students)
      .innerJoin(positions, eq(students.positionId, positions.id))
      .where(and(eq(positions.picksCloses, true), eq(students.onRoster, true)))
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
