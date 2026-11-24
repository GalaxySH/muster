/**
 * Server-side reads for the SL weekend-close claim subsystem (PLAN.md §18a).
 * Pure rules (required count, capacity, feasibility) live in
 * `domain/close-claims.ts`; this layer only loads and joins. The whole step is
 * dormant until an admin generates a slot inventory (`hasCloseInventory`).
 */
import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  closeClaims,
  closeRequirements,
  closeSlots,
  positions,
  students,
  termMembers,
  terms,
} from "@/lib/db/schema";
import {
  closeClaimsComplete,
  closeClaimsFeasibility,
  closeLeadStatus,
  remainingCapacity,
  type CloseFeasibility,
  type CloseLeadStatus,
  type CloseSlotKind,
} from "@/lib/domain/close-claims";
import { workingTermId } from "@/lib/terms/working";
import { closeClaimInTerm, memberOf } from "@/lib/terms/scope";
import { closeRequirementOf, requirementOfMember, type CloseRequirement } from "./requirements";

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
  /** How many closes the viewing lead owes this term. */
  required: number;
}

/** Whether the term has any close slots; everything SL-closes stays hidden until it does. */
export async function hasCloseInventory(): Promise<boolean> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(closeSlots)
    .where(eq(closeSlots.termId, await workingTermId()));
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

/**
 * How many closes this person owes in the working term, or null when closes
 * have nothing to do with them: their position picks none, or no inventory has
 * been generated yet. A lead who owes 0 gets a number, not null, so the admin
 * still sees them; `closeStepApplies` decides whether the student sees the step.
 */
export async function loadCloseRequirement(
  email: string,
  positionId: string | null,
): Promise<CloseRequirement | null> {
  if (!(await positionPicksCloses(positionId))) return null;
  if (!(await hasCloseInventory())) return null;
  return closeRequirementOf(getDb(), await workingTermId(), email);
}

export async function countCloseClaims(email: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(closeClaims)
    .where(and(eq(closeClaims.studentEmail, email), closeClaimInTerm(await workingTermId())));
  return row?.n ?? 0;
}

export async function loadCloseBoard(email: string): Promise<CloseBoard> {
  const db = getDb();
  const termId = await workingTermId();
  const [slots, counts, mine, requirement] = await Promise.all([
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
    closeRequirementOf(db, termId, email),
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
    required: requirement.required,
  };
}

export interface StudentCloseClaims {
  /** The slots this student holds, earliest first. */
  claims: { id: string; date: string; startMinutes: number; endMinutes: number }[];
  /** How many they owe this term. */
  required: number;
  complete: boolean;
}

/**
 * One student's claimed closes for the admin per-student view, or null when
 * closes don't apply to them (not a Shift Lead, or no inventory yet).
 */
export async function loadStudentCloseClaims(
  email: string,
  positionId: string | null,
): Promise<StudentCloseClaims | null> {
  const requirement = await loadCloseRequirement(email, positionId);
  if (!requirement) return null;
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
      and(eq(closeClaims.studentEmail, email), eq(closeSlots.termId, await workingTermId())),
    )
    .orderBy(asc(closeSlots.date));
  return {
    claims,
    required: requirement.required,
    complete: closeClaimsComplete(claims.length, requirement.required),
  };
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
  /** How many this lead owes. */
  required: number;
  /** False when they have no number of their own yet and the default stands in. */
  assigned: boolean;
  status: CloseLeadStatus;
  /** Holds at least their number. */
  complete: boolean;
}

export interface CloseAdminView {
  slots: AdminCloseSlot[];
  /** Active (on-roster) Shift Leads and how far along their picks are. */
  leads: ShiftLeadProgress[];
  /** The term's default number, which a new lead starts on. */
  defaultRequirement: number;
  feasibility: CloseFeasibility;
}

export async function loadCloseAdmin(): Promise<CloseAdminView> {
  const db = getDb();
  const termId = await workingTermId();
  const [slots, claims, leadRows, termRows] = await Promise.all([
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
      .select({
        email: students.email,
        displayName: students.displayName,
        ownRequirement: closeRequirements.required,
      })
      .from(students)
      .innerJoin(termMembers, memberOf(termId))
      .innerJoin(positions, eq(termMembers.positionId, positions.id))
      .leftJoin(closeRequirements, requirementOfMember())
      .where(and(eq(positions.picksCloses, true), eq(termMembers.onRoster, true)))
      .orderBy(asc(students.displayName), asc(students.email)),
    db
      .select({ closeRequirement: terms.closeRequirement })
      .from(terms)
      .where(eq(terms.id, termId))
      .limit(1),
  ]);
  const defaultRequirement = termRows[0]?.closeRequirement ?? 0;

  const claimantsBySlot = new Map<string, CloseClaimant[]>();
  const countByEmail = new Map<string, number>();
  for (const c of claims) {
    const list = claimantsBySlot.get(c.slotId) ?? [];
    list.push({ email: c.email, displayName: c.displayName, claimedAt: c.claimedAt });
    claimantsBySlot.set(c.slotId, list);
    countByEmail.set(c.email, (countByEmail.get(c.email) ?? 0) + 1);
  }

  const leads = leadRows.map((l): ShiftLeadProgress => {
    const claimCount = countByEmail.get(l.email) ?? 0;
    const required = l.ownRequirement ?? defaultRequirement;
    return {
      email: l.email,
      displayName: l.displayName,
      claimCount,
      required,
      assigned: l.ownRequirement !== null,
      status: closeLeadStatus(claimCount, required),
      complete: closeClaimsComplete(claimCount, required),
    };
  });

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
    leads,
    defaultRequirement,
    feasibility: closeClaimsFeasibility({
      totalCapacity: slots.reduce((n, s) => n + s.capacity, 0),
      requirements: leads.map((l) => l.required),
    }),
  };
}
