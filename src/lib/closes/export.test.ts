import { describe, it, expect } from "vitest";
import {
  buildCloseClaimsMatrix,
  CLOSE_EXPORT_HEADERS,
  CLOSE_LEAD_HEADERS,
  type CloseExportSlot,
} from "./export";

const slot = (over: Partial<CloseExportSlot> = {}): CloseExportSlot => ({
  date: "2026-09-04",
  kind: "fri",
  startMinutes: 18 * 60,
  endMinutes: 23 * 60 + 30,
  capacity: 3,
  claimants: [],
  ...over,
});

describe("buildCloseClaimsMatrix", () => {
  it("starts with the header row", () => {
    expect(buildCloseClaimsMatrix([])[0]).toEqual([...CLOSE_EXPORT_HEADERS]);
  });

  it("renders one row per slot with counts and claimant names", () => {
    const matrix = buildCloseClaimsMatrix([
      slot({
        claimants: [
          { displayName: "Ada Lovelace", email: "ada@wisc.edu" },
          { displayName: "Grace Hopper", email: "grace@wisc.edu" },
        ],
      }),
      slot({ date: "2026-09-05", kind: "sat", capacity: 2 }),
    ]);
    expect(matrix[1]).toEqual([
      "2026-09-04",
      "Fri",
      "6p–11:30p",
      "3",
      "2",
      "1",
      "Ada Lovelace <ada@wisc.edu>; Grace Hopper <grace@wisc.edu>",
    ]);
    expect(matrix[2]).toEqual(["2026-09-05", "Sat", "6p–11:30p", "2", "0", "2", ""]);
  });

  it("never reports negative open seats", () => {
    const matrix = buildCloseClaimsMatrix([
      slot({
        capacity: 1,
        claimants: [
          { displayName: "A", email: "a@wisc.edu" },
          { displayName: "B", email: "b@wisc.edu" },
        ],
      }),
    ]);
    expect(matrix[1]?.[5]).toBe("0");
  });

  it("lists each lead's required number after the slots", () => {
    const matrix = buildCloseClaimsMatrix(
      [slot()],
      [
        { displayName: "Lovelace, Ada", email: "ada@wisc.edu", required: 3, claimCount: 1, status: "short" },
        { displayName: "Hopper, Grace", email: "grace@wisc.edu", required: 1, claimCount: 1, status: "done" },
      ],
    );
    expect(matrix.slice(2)).toEqual([
      [],
      [...CLOSE_LEAD_HEADERS],
      ["Lovelace, Ada", "ada@wisc.edu", "3", "1", "Short"],
      ["Hopper, Grace", "grace@wisc.edu", "1", "1", "Done"],
    ]);
  });

  it("adds no lead table when there are no leads", () => {
    expect(buildCloseClaimsMatrix([slot()])).toHaveLength(2);
  });
});
