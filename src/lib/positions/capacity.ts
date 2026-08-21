/**
 * Target staffing writes that come from outside the positions module.
 *
 * `shift_blocks.desired_capacity` is position config, so the admin form on
 * /admin/positions owns it and validates every value it writes. The W2W plan
 * import writes it too, from the seat count W2W budgeted for a shift, and it
 * used to reach straight for the table: another module writing config with no
 * check, where the module that owns the column refuses anything outside 1 to
 * DESIRED_CAPACITY_MAX. A plan carrying an implausible seat count could
 * therefore put a number in config that the admin form would never accept.
 *
 * This is the seam that write goes through now (plan item A6). The admin form
 * still writes the column itself, because it sets capacity in the same
 * statement that moves a block's hours and splitting that into two updates
 * would be worse; what it does not do is skip the check.
 */
import { eq } from "drizzle-orm";
import { shiftBlocks } from "@/lib/db/schema";
import { validateDesiredCapacity } from "@/lib/domain/config-validation";
import type { DbTx } from "./apply-change";

/** One block's new target, or null to clear it. */
export interface CapacityTarget {
  blockId: string;
  desiredCapacity: number | null;
}

/**
 * Thrown when a target is out of range. A sentinel rather than a return value
 * because the write runs inside a caller's transaction: throwing is what rolls
 * the rest of the batch back. It carries the offending target so each surface
 * can word its own refusal, the admin form and a plan import having very
 * different things to say about the same illegal number.
 */
export class CapacityRefused extends Error {
  constructor(
    message: string,
    readonly target: CapacityTarget,
  ) {
    super(message);
    this.name = "CapacityRefused";
  }
}

/**
 * Write target staffing for a set of blocks inside the caller's transaction.
 * Every value is checked before any of them is written, so a bad one refuses
 * the batch whole rather than leaving part of it applied. Returns how many
 * rows were written.
 */
export async function setBlockCapacities(
  tx: DbTx,
  targets: readonly CapacityTarget[],
): Promise<number> {
  for (const target of targets) {
    const error = validateDesiredCapacity(target.desiredCapacity);
    if (error) throw new CapacityRefused(error, target);
  }
  for (const target of targets) {
    await tx
      .update(shiftBlocks)
      .set({ desiredCapacity: target.desiredCapacity })
      .where(eq(shiftBlocks.id, target.blockId));
  }
  return targets.length;
}
