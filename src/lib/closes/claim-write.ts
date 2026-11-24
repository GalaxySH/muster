/**
 * The concurrency-critical close-claim insert (PLAN.md §18a), shared by the
 * student claim action and the admin assign action so both go through the
 * same locking transaction: student row first (serializing one lead's
 * parallel claims), then the slot row (serializing the capacity check), then
 * counts and inserts. The fixed student → slot lock order prevents deadlocks,
 * and the composite PK (slot, email) backstops double-claims. Callers map the
 * returned code to their own user-facing message.
 */
import "server-only";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { closeClaims, closeSlots, students } from "@/lib/db/schema";
import { REQUIRED_CLOSE_CLAIMS, remainingCapacity } from "@/lib/domain/close-claims";
import { currentTermId } from "@/lib/terms/current";
import { closeClaimInTerm } from "@/lib/terms/scope";

export type CloseClaimError = "gone" | "lead-full" | "slot-full";

/**
 * Insert a claim if the slot exists in the current term, the lead has room, and
 * a seat is open. A slot from another term reads as gone, and only this term's
 * claims count toward the lead's limit.
 */
export async function insertCloseClaim(
  slotId: string,
  email: string,
): Promise<CloseClaimError | null> {
  const termId = await currentTermId();
  return getDb().transaction(async (tx) => {
    await tx
      .select({ email: students.email })
      .from(students)
      .where(eq(students.email, email))
      .for("update");
    const [slot] = await tx
      .select()
      .from(closeSlots)
      .where(and(eq(closeSlots.id, slotId), eq(closeSlots.termId, termId)))
      .for("update");
    if (!slot) return "gone";

    const [held] = await tx
      .select({ slotId: closeClaims.closeSlotId })
      .from(closeClaims)
      .where(and(eq(closeClaims.closeSlotId, slotId), eq(closeClaims.studentEmail, email)))
      .limit(1);
    if (held) return null; // already theirs; treat the repeat as a no-op

    const [mine] = await tx
      .select({ n: count() })
      .from(closeClaims)
      .where(and(eq(closeClaims.studentEmail, email), closeClaimInTerm(termId)));
    if ((mine?.n ?? 0) >= REQUIRED_CLOSE_CLAIMS) return "lead-full";

    const [claimed] = await tx
      .select({ n: count() })
      .from(closeClaims)
      .where(eq(closeClaims.closeSlotId, slotId));
    if (remainingCapacity(slot.capacity, claimed?.n ?? 0) <= 0) return "slot-full";

    await tx.insert(closeClaims).values({ closeSlotId: slotId, studentEmail: email });
    return null;
  });
}
