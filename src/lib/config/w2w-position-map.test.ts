import { describe, it, expect } from "vitest";
import { W2W_POSITION_MAP_SEED } from "./w2w-position-map";
import { POSITION_CONFIGS } from "./positions";
import { TITLE_TO_POSITION } from "../roster/position-mapping";

const SEEDED_POSITION_IDS = new Set(POSITION_CONFIGS.map((c) => c.position.id));

describe("W2W_POSITION_MAP_SEED", () => {
  /**
   * Both seed paths filter to positions the DB actually has, so a row naming a
   * position that does not exist is dropped in silence and its W2W shifts can
   * never be filled. That shipped once (`retail-and-cafe-team-member`, fixed
   * in v1.11); this is the guard.
   */
  it("only maps onto positions the position fixture seeds", () => {
    const dangling = W2W_POSITION_MAP_SEED.filter(
      (m) => !SEEDED_POSITION_IDS.has(m.musterPositionId),
    ).map((m) => `${m.w2wPositionName} -> ${m.musterPositionId}`);
    expect(dangling).toEqual([]);
  });

  it("agrees with the roster title map about where a shared title lands", () => {
    // Both fixtures name the same real-world roles. Where a roster title and a
    // W2W position mean the same job, they must resolve to one position, or
    // the students land somewhere their shifts are not.
    expect(TITLE_TO_POSITION["retail and cafe team member"]).toBe(
      W2W_POSITION_MAP_SEED.find((m) => m.w2wPositionName === "GDEC - R&C TM")?.musterPositionId,
    );
  });

  it("keys each W2W position once, by id and by name", () => {
    // Matching resolves by id then by name, keeping the first entry for each,
    // so a duplicate on either key makes resolution depend on row order.
    const ids = W2W_POSITION_MAP_SEED.map((m) => m.w2wPositionId);
    const names = W2W_POSITION_MAP_SEED.map((m) => m.w2wPositionName);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives W2W positions sharing a Muster position distinct fill orders", () => {
    const byPosition = new Map<string, number[]>();
    for (const m of W2W_POSITION_MAP_SEED) {
      byPosition.set(m.musterPositionId, [
        ...(byPosition.get(m.musterPositionId) ?? []),
        m.fillOrder,
      ]);
    }
    for (const [positionId, orders] of byPosition) {
      expect(new Set(orders).size, `fill orders for ${positionId}`).toBe(orders.length);
    }
  });
});
