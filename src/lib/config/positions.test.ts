import { describe, it, expect } from "vitest";
import { POSITION_CONFIGS, blocksFor, SHIFT_BLOCKS } from "./positions";
import { deriveOpenClose } from "@/lib/domain/blocks";
import { formatTime } from "@/lib/domain/time";
import type { DayType } from "@/lib/domain/types";

/** Expected open/close per PLAN.md §6.3 (open start time, close end time). */
const EXPECTED: Record<string, Partial<Record<DayType, { open: string; close: string }>>> = {
  "shift-lead": {
    weekday: { open: "6a", close: "11:30p" },
    weekend: { open: "8a", close: "11:30p" },
  },
  "culinary-assistant": {
    weekday: { open: "6:30a", close: "11:30p" },
    weekend: { open: "8:30a", close: "11:30p" },
  },
  barista: { weekday: { open: "6:15a", close: "5p" } },
  cashier: {
    weekday: { open: "6:45a", close: "11:30p" },
    weekend: { open: "8:45a", close: "11:30p" },
  },
  dishwasher: {
    weekday: { open: "7a", close: "11:30p" },
    weekend: { open: "8:30a", close: "11:30p" },
  },
  stocker: {
    weekday: { open: "8:30a", close: "11:30p" },
    weekend: { open: "8:30a", close: "11:30p" },
  },
};

describe("canonical position config", () => {
  it("defines exactly the six selectable positions", () => {
    expect(POSITION_CONFIGS.map((c) => c.position.id)).toEqual([
      "shift-lead",
      "culinary-assistant",
      "barista",
      "cashier",
      "dishwasher",
      "stocker",
    ]);
  });

  it("uses globally unique block ids", () => {
    const ids = SHIFT_BLOCKS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes Barista weekday-only and weekend-exempt", () => {
    const barista = POSITION_CONFIGS.find((c) => c.position.id === "barista")!;
    expect(barista.position.weekendExempt).toBe(true);
    expect(barista.blocks.some((b) => b.dayType === "weekend")).toBe(false);
  });

  it("derives open/close matching the PLAN.md §6.3 annotations", () => {
    for (const [positionId, dayTypes] of Object.entries(EXPECTED)) {
      for (const [dayType, expected] of Object.entries(dayTypes)) {
        const blocks = blocksFor(positionId).filter((b) => b.dayType === dayType);
        const { openId, closeId } = deriveOpenClose(blocks);
        const open = blocks.find((b) => b.id === openId)!;
        const close = blocks.find((b) => b.id === closeId)!;
        expect(formatTime(open.start), `${positionId} ${dayType} open`).toBe(expected.open);
        expect(formatTime(close.end), `${positionId} ${dayType} close`).toBe(expected.close);
      }
    }
  });
});
