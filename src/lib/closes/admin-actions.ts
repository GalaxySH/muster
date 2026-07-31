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
import { closeClaims, closeSlots, students } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
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
  REQUIRED_CLOSE_CLAIMS,
  SHIFT_LEAD_POSITION_ID,
  generateCloseSlotDates,
  formatCloseDate,
} from "@/lib/domain/close-claims";
import { insertCloseClaim } from "./claim-write";

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

export async function generateCloseInventory(input: {
  start: string;
  end: string;
  capacity: number;
}): Promise<GenerateInventoryResult> {
  const gate = await requireAdmin();
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
    const existing = await tx.select().from(closeSlots);
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
  "lead-full": `That lead already has ${REQUIRED_CLOSE_CLAIMS} closes. Remove one of theirs first.`,
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

  const [lead] = await getDb()
    .select({ positionId: students.positionId, onRoster: students.onRoster })
    .from(students)
    .where(eq(students.email, email))
    .limit(1);
  if (!lead || lead.positionId !== SHIFT_LEAD_POSITION_ID || !lead.onRoster)
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
    .where(eq(closeSlots.id, slotId))
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
    .where(and(eq(closeClaims.closeSlotId, slotId), eq(closeClaims.studentEmail, email)));

  await afterClaimChange();
  return { ok: true };
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
