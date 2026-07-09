"use server";

/**
 * Claim/release actions for SL weekend closes (PLAN.md §18a).
 *
 * The claim write is the concurrency-critical path: two leads must never take
 * the last seat at once. Strategy (per PLAN §18a): one transaction that locks
 * the student row first (serializing one student's parallel claims), then the
 * slot row (serializing the slot's capacity check), then counts and inserts.
 * The consistent student → slot lock order prevents deadlocks, and the
 * composite PK (slot, email) backstops double-claims. On a lost race the
 * student gets a "just filled" message plus the refreshed board, so the UI
 * self-corrects; there is no global pick lock.
 */
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { closeClaims, closeSlots, students } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { requireEditableStudent } from "@/lib/groups/gate";
import { trySyncSheet, CLOSES_SHEET } from "@/lib/admin/sheet-sync";
import {
  REQUIRED_CLOSE_CLAIMS,
  SHIFT_LEAD_POSITION_ID,
  remainingCapacity,
} from "@/lib/domain/close-claims";
import { loadCloseBoard, type CloseBoard } from "./data";

export interface CloseActionResult {
  ok: boolean;
  error?: string;
  /** The refreshed board (also on errors, so stale counts self-correct). */
  board: CloseBoard | null;
}

async function gateShiftLead(): Promise<
  { ok: true; email: string } | { ok: false; error: string }
> {
  const gate = await requireEditableStudent();
  if (!gate.ok) return gate;
  if (gate.positionId !== SHIFT_LEAD_POSITION_ID)
    return { ok: false, error: "Only Shift Leads pick weekend closes." };
  return { ok: true, email: gate.email };
}

export async function claimCloseSlot(slotId: string): Promise<CloseActionResult> {
  const gate = await gateShiftLead();
  if (!gate.ok) return { ok: false, error: gate.error, board: null };
  const email = gate.email;
  const db = getDb();

  const error = await db.transaction(async (tx) => {
    // Lock order is student → slot everywhere so parallel claims can't deadlock.
    await tx
      .select({ email: students.email })
      .from(students)
      .where(eq(students.email, email))
      .for("update");
    const [slot] = await tx
      .select()
      .from(closeSlots)
      .where(eq(closeSlots.id, slotId))
      .for("update");
    if (!slot) return "That shift is no longer available.";

    const [held] = await tx
      .select({ slotId: closeClaims.closeSlotId })
      .from(closeClaims)
      .where(and(eq(closeClaims.closeSlotId, slotId), eq(closeClaims.studentEmail, email)))
      .limit(1);
    if (held) return null; // already theirs; treat the re-click as a no-op

    const [mine] = await tx
      .select({ n: count() })
      .from(closeClaims)
      .where(eq(closeClaims.studentEmail, email));
    if ((mine?.n ?? 0) >= REQUIRED_CLOSE_CLAIMS)
      return `You already have ${REQUIRED_CLOSE_CLAIMS} closes. Release one first to switch.`;

    const [claimed] = await tx
      .select({ n: count() })
      .from(closeClaims)
      .where(eq(closeClaims.closeSlotId, slotId));
    if (remainingCapacity(slot.capacity, claimed?.n ?? 0) <= 0)
      return "That shift just filled up. Pick another one.";

    await tx.insert(closeClaims).values({ closeSlotId: slotId, studentEmail: email });
    return null;
  });

  if (!error) {
    revalidatePath("/closes");
    await trySyncSheet(CLOSES_SHEET);
  }
  return { ok: !error, error: error ?? undefined, board: await loadCloseBoard(email) };
}

/** Release one of the student's own claims; the seat returns to the pool. */
export async function releaseCloseClaim(slotId: string): Promise<CloseActionResult> {
  const gate = await gateShiftLead();
  if (!gate.ok) return { ok: false, error: gate.error, board: null };

  await getDb()
    .delete(closeClaims)
    .where(and(eq(closeClaims.closeSlotId, slotId), eq(closeClaims.studentEmail, gate.email)));
  revalidatePath("/closes");
  await trySyncSheet(CLOSES_SHEET);
  return { ok: true, board: await loadCloseBoard(gate.email) };
}

/** Read-only poll for live remaining counts; any signed-in student may read. */
export async function refreshCloseBoard(): Promise<CloseBoard | null> {
  const session = await getAppSession();
  if (!session) return null;
  return loadCloseBoard(session.email);
}
