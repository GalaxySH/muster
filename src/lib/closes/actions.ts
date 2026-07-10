"use server";

/**
 * Claim/release actions for SL weekend closes (PLAN.md §18a). The
 * concurrency-critical claim write lives in `claim-write.ts` (shared with the
 * admin assign action); on a lost race the student gets a "just filled"
 * message plus the refreshed board, so the UI self-corrects without a lock.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { closeClaims } from "@/lib/db/schema";
import { getAppSession } from "@/lib/auth/session";
import { requireEditableStudent } from "@/lib/groups/gate";
import { trySyncSheet, CLOSES_SHEET } from "@/lib/admin/sheet-sync";
import { REQUIRED_CLOSE_CLAIMS, SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { insertCloseClaim } from "./claim-write";
import { loadCloseBoard, type CloseBoard } from "./data";

export interface CloseActionResult {
  ok: boolean;
  error?: string;
  /** The refreshed board (also on errors, so stale slot status self-corrects). */
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

const CLAIM_ERROR_MESSAGES = {
  gone: "That shift is no longer available.",
  "lead-full": `You already have ${REQUIRED_CLOSE_CLAIMS} closes. Release one first to switch.`,
  "slot-full": "That shift just filled up. Pick another one.",
} as const;

export async function claimCloseSlot(slotId: string): Promise<CloseActionResult> {
  const gate = await gateShiftLead();
  if (!gate.ok) return { ok: false, error: gate.error, board: null };
  const email = gate.email;

  const code = await insertCloseClaim(slotId, email);
  const error = code ? CLAIM_ERROR_MESSAGES[code] : null;

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

/** Read-only poll for live open/full status; any signed-in student may read. */
export async function refreshCloseBoard(): Promise<CloseBoard | null> {
  const session = await getAppSession();
  if (!session) return null;
  return loadCloseBoard(session.email);
}
