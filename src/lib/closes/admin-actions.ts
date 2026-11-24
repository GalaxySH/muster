"use server";

/**
 * Admin mutations for the SL closes inventory (PLAN.md §18a). The inventory is
 * generated from a semester range + one per-slot capacity (stored data, not
 * hardcoded); regenerating is idempotent: missing slots are created, in-range
 * capacities updated, out-of-range slots removed only when nobody holds a
 * claim on them (claimed ones are kept and reported instead).
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  closeClaims,
  closeRequirements,
  closeSlots,
  positions,
  termMembers,
} from "@/lib/db/schema";
import { requireAdmin, requireAdminIn } from "@/lib/auth/require-admin";
import {
  syncSheet,
  trySyncSheet,
  CLOSES_SHEET,
  SHEET_MANUAL_COOLDOWN_MS,
  type SheetSyncResult,
} from "@/lib/admin/sheet-sync";
import {
  CLOSE_START_MINUTES,
  CLOSE_END_MINUTES,
  MAX_CLOSE_REQUIREMENT,
  generateCloseSlotDates,
  formatCloseDate,
  isValidCloseRequirement,
} from "@/lib/domain/close-claims";
import { ensureCloseRequirements } from "./requirements";
import { insertCloseClaim } from "./claim-write";
import { positionPicksCloses } from "./data";
import { workingTermId } from "@/lib/terms/working";
import { closeClaimInTerm } from "@/lib/terms/scope";
import { findStudentByEmail } from "@/lib/roster/lookup";

export interface InventorySummary {
  created: number;
  capacityUpdated: number;
  removed: number;
  /** Out-of-range slots kept because leads already hold claims on them. */
  keptWithClaims: string[];
  /** In-range slots whose existing claims now exceed the new capacity. */
  overClaimed: string[];
}

export interface GenerateInventoryResult {
  ok: boolean;
  error?: string;
  summary?: InventorySummary;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CAPACITY = 20;

export async function generateCloseInventory(
  termId: string,
  input: { start: string; end: string; capacity: number },
): Promise<GenerateInventoryResult> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const { start, end } = input;
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end))
    return { ok: false, error: "Enter both dates." };
  if (end < start) return { ok: false, error: "The end date must be on or after the start date." };
  const capacity = Math.floor(input.capacity);
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > MAX_CAPACITY)
    return { ok: false, error: `Capacity must be between 1 and ${MAX_CAPACITY}.` };

  const wanted = generateCloseSlotDates(start, end);
  if (wanted.length === 0)
    return { ok: false, error: "That range contains no Fridays or Saturdays." };

  const db = getDb();
  const summary = await db.transaction(async (tx): Promise<InventorySummary> => {
    // The inventory is what switches closes on, so every lead has a number by then.
    await ensureCloseRequirements(tx, termId);
    const existing = await tx.select().from(closeSlots).where(eq(closeSlots.termId, termId));
    const claimCounts = await tx
      .select({ slotId: closeClaims.closeSlotId, n: count() })
      .from(closeClaims)
      .groupBy(closeClaims.closeSlotId);
    const claimsBySlot = new Map(claimCounts.map((c) => [c.slotId, c.n]));
    const existingByDate = new Map(existing.map((s) => [s.date, s]));
    const wantedDates = new Set(wanted.map((w) => w.date));

    const toInsert = wanted
      .filter((w) => !existingByDate.has(w.date))
      .map((w) => ({
        id: randomUUID(),
        termId,
        date: w.date,
        kind: w.kind,
        startMinutes: CLOSE_START_MINUTES,
        endMinutes: CLOSE_END_MINUTES,
        capacity,
      }));
    if (toInsert.length) await tx.insert(closeSlots).values(toInsert);

    let capacityUpdated = 0;
    const overClaimed: string[] = [];
    for (const s of existing) {
      if (!wantedDates.has(s.date)) continue;
      if (s.capacity !== capacity) {
        await tx.update(closeSlots).set({ capacity }).where(eq(closeSlots.id, s.id));
        capacityUpdated++;
      }
      if ((claimsBySlot.get(s.id) ?? 0) > capacity) overClaimed.push(formatCloseDate(s.date));
    }

    const outOfRange = existing.filter((s) => !wantedDates.has(s.date));
    const removable = outOfRange.filter((s) => (claimsBySlot.get(s.id) ?? 0) === 0);
    if (removable.length)
      await tx.delete(closeSlots).where(
        inArray(
          closeSlots.id,
          removable.map((s) => s.id),
        ),
      );

    return {
      created: toInsert.length,
      capacityUpdated,
      removed: removable.length,
      keptWithClaims: outOfRange
        .filter((s) => (claimsBySlot.get(s.id) ?? 0) > 0)
        .map((s) => formatCloseDate(s.date)),
      overClaimed,
    };
  });

  revalidatePath("/admin/closes");
  revalidatePath("/closes");
  await trySyncSheet(CLOSES_SHEET, 0);
  return { ok: true, summary };
}

export interface CloseAssignResult {
  ok: boolean;
  error?: string;
}

const ASSIGN_ERROR_MESSAGES = {
  gone: "That shift no longer exists.",
  "lead-full": "That lead already has all their closes. Remove one of theirs first.",
  "slot-full": "That shift is already full.",
} as const;

/** After an admin claim change: refresh both surfaces and back up the sheet. */
async function afterClaimChange() {
  revalidatePath("/admin/closes");
  revalidatePath("/closes");
  await trySyncSheet(CLOSES_SHEET);
}

/**
 * Admin: put a Shift Lead on a close shift, no student interaction needed.
 * Goes through the same locking insert as student claims, so capacity and the
 * per-lead limit hold even against a concurrent student pick.
 */
export async function assignCloseClaim(slotId: string, email: string): Promise<CloseAssignResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const lead = await findStudentByEmail(email);
  if (!lead?.onRoster || !(await positionPicksCloses(lead.positionId)))
    return { ok: false, error: "Pick an active Shift Lead." };

  const code = await insertCloseClaim(slotId, email);
  if (code) return { ok: false, error: ASSIGN_ERROR_MESSAGES[code] };

  await afterClaimChange();
  return { ok: true };
}

/**
 * Admin: delete a single close shift from the inventory (e.g. drop the Friday
 * of a holiday weekend). Unlike regeneration, this removes the slot even when
 * leads hold claims on it; the claims cascade away and those leads fall below
 * the required count, so the client confirms first.
 */
export async function removeCloseSlot(slotId: string): Promise<CloseAssignResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const db = getDb();
  const [slot] = await db
    .select({ id: closeSlots.id })
    .from(closeSlots)
    .where(and(eq(closeSlots.id, slotId), eq(closeSlots.termId, await workingTermId())))
    .limit(1);
  if (!slot) return { ok: false, error: "That shift no longer exists." };

  await db.delete(closeSlots).where(eq(closeSlots.id, slotId));

  await afterClaimChange();
  return { ok: true };
}

/** Admin: take a Shift Lead off a close shift; the spot returns to the pool. */
export async function unassignCloseClaim(
  slotId: string,
  email: string,
): Promise<CloseAssignResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  await getDb()
    .delete(closeClaims)
    .where(
      and(
        eq(closeClaims.closeSlotId, slotId),
        eq(closeClaims.studentEmail, email),
        closeClaimInTerm(await workingTermId()),
      ),
    );

  await afterClaimChange();
  return { ok: true };
}

export interface SetCloseRequirementsResult {
  ok: boolean;
  error?: string;
  /** How many leads now carry the number. */
  updated?: number;
}

/**
 * Admin: set how many closes one lead, or several together, owe this term.
 *
 * It releases nothing. A lead left holding more than their new number shows as
 * over and can unpick; one left short shows as short. Only people who hold a
 * closes position in the term can be given a number. The same people can be
 * leads in two terms, so the page says which term it is showing.
 */
export async function setCloseRequirements(
  termId: string,
  emails: string[],
  required: number,
): Promise<SetCloseRequirementsResult> {
  const gate = await requireAdminIn(termId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isValidCloseRequirement(required))
    return { ok: false, error: `Enter a whole number from 0 to ${MAX_CLOSE_REQUIREMENT}.` };

  const wanted = [
    ...new Set(
      (Array.isArray(emails) ? emails : [])
        .map((e) => String(e).trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (wanted.length === 0) return { ok: false, error: "Pick at least one lead." };

  const db = getDb();
  const leads = await db
    .select({ email: termMembers.studentEmail })
    .from(termMembers)
    .innerJoin(positions, eq(positions.id, termMembers.positionId))
    .where(
      and(
        eq(termMembers.termId, termId),
        eq(positions.picksCloses, true),
        inArray(termMembers.studentEmail, wanted),
      ),
    );
  if (leads.length !== wanted.length)
    return { ok: false, error: "Someone on that list is no longer a Shift Lead. Reload the page." };

  const stamp = { required, setBy: gate.email, setAt: new Date() };
  await db
    .insert(closeRequirements)
    .values(leads.map((l) => ({ termId, studentEmail: l.email, ...stamp })))
    .onDuplicateKeyUpdate({ set: stamp });

  revalidatePath("/me");
  revalidatePath("/admin");
  revalidatePath("/admin/students/[email]", "page");
  await afterClaimChange();
  return { ok: true, updated: leads.length };
}

export interface RebuildClosesSheetResult {
  ok: boolean;
  error?: string;
  sync?: SheetSyncResult;
}

/** Admin: rebuild the closes backup sheet in Drive (30-second manual cooldown). */
export async function rebuildClosesSheet(): Promise<RebuildClosesSheetResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    const sync = await syncSheet(CLOSES_SHEET, { cooldownMs: SHEET_MANUAL_COOLDOWN_MS });
    revalidatePath("/admin/closes");
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sheet sync failed." };
  }
}
