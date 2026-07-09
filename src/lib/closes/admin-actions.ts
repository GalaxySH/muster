"use server";

/**
 * Admin mutations for the SL closes inventory (PLAN.md §18a). The inventory is
 * generated from a semester range + one per-slot capacity (stored data, not
 * hardcoded); regenerating is idempotent: missing slots are created, in-range
 * capacities updated, out-of-range slots removed only when nobody holds a
 * claim on them (claimed ones are kept and reported instead).
 */
import { randomUUID } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { closeClaims, closeSlots } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  syncSheet,
  CLOSES_SHEET,
  SHEET_MANUAL_COOLDOWN_MS,
  type SheetSyncResult,
} from "@/lib/admin/sheet-sync";
import {
  CLOSE_START_MINUTES,
  CLOSE_END_MINUTES,
  generateCloseSlotDates,
  formatCloseDate,
} from "@/lib/domain/close-claims";

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
  if (end < start)
    return { ok: false, error: "The end date must be on or after the start date." };
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
  try {
    await syncSheet(CLOSES_SHEET, { cooldownMs: 0 });
  } catch (e) {
    console.error("Closes sheet sync after inventory change failed (non-fatal):", e);
  }
  return { ok: true, summary };
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
