import { describe, expect, it } from "vitest";
import { DESIRED_CAPACITY_MAX } from "@/lib/domain/config-validation";
import { CapacityRefused, setBlockCapacities, type CapacityTarget } from "./capacity";
import type { DbTx } from "./apply-change";

/**
 * Enough of the drizzle write chain to record what a call would have written.
 * `where` ends the chain and is what gets awaited, so a recorded value means
 * the statement was actually issued, not merely built.
 */
function fakeTx() {
  const written: (number | null)[] = [];
  const tx = {
    update: () => {
      const chain = {
        set(values: { desiredCapacity: number | null }) {
          written.push(values.desiredCapacity);
          return chain;
        },
        where: () => Promise.resolve([]),
      };
      return chain;
    },
  };
  return { tx: tx as unknown as DbTx, written };
}

const target = (blockId: string, desiredCapacity: number | null): CapacityTarget => ({
  blockId,
  desiredCapacity,
});

describe("setBlockCapacities", () => {
  it("writes every target and reports how many", async () => {
    const { tx, written } = fakeTx();
    const count = await setBlockCapacities(tx, [target("a", 3), target("b", 1), target("c", null)]);
    expect(count).toBe(3);
    expect(written).toEqual([3, 1, null]);
  });

  it("writes nothing at all when one target is out of range", async () => {
    // The check runs over the whole batch before the first write, so a bad
    // value at the END still stops the good ones ahead of it. Anything less
    // would leave a partly applied import behind.
    const { tx, written } = fakeTx();
    await expect(
      setBlockCapacities(tx, [target("a", 3), target("b", DESIRED_CAPACITY_MAX + 1)]),
    ).rejects.toBeInstanceOf(CapacityRefused);
    expect(written).toEqual([]);
  });

  it("refuses the values the admin form refuses", async () => {
    for (const bad of [0, -1, 2.5, DESIRED_CAPACITY_MAX + 1]) {
      const { tx, written } = fakeTx();
      await expect(setBlockCapacities(tx, [target("a", bad)])).rejects.toBeInstanceOf(
        CapacityRefused,
      );
      expect(written).toEqual([]);
    }
  });

  it("carries the offending target so a caller can word its own refusal", async () => {
    const { tx } = fakeTx();
    await expect(setBlockCapacities(tx, [target("dock-am", 400)])).rejects.toMatchObject({
      target: { blockId: "dock-am", desiredCapacity: 400 },
    });
  });

  it("accepts the boundaries", async () => {
    const { tx, written } = fakeTx();
    await setBlockCapacities(tx, [target("a", 1), target("b", DESIRED_CAPACITY_MAX)]);
    expect(written).toEqual([1, DESIRED_CAPACITY_MAX]);
  });

  it("writes nothing for an empty batch", async () => {
    const { tx, written } = fakeTx();
    expect(await setBlockCapacities(tx, [])).toBe(0);
    expect(written).toEqual([]);
  });
});
