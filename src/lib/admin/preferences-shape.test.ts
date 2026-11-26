import { describe, expect, it } from "vitest";
import {
  COLUMN_SHARE_MAX,
  COLUMN_SHARE_MIN,
  EMPTY_PREFS,
  normalizeShares,
  normalizeStudentLayout,
  parseAdminPrefs,
} from "./preferences-shape";

const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);

describe("parseAdminPrefs", () => {
  it("falls back to the defaults on nothing, junk or a wrong shape", () => {
    expect(parseAdminPrefs(null)).toEqual(EMPTY_PREFS);
    expect(parseAdminPrefs("{not json")).toEqual(EMPTY_PREFS);
    expect(parseAdminPrefs("[]")).toEqual(EMPTY_PREFS);
  });

  it("keeps a good field when another is bad", () => {
    const prefs = parseAdminPrefs(JSON.stringify({ theme: "dark", studentLayout: { columns: 3 } }));
    expect(prefs).toEqual({ theme: "dark", studentLayout: null, foldedCards: [] });
  });

  it("keeps only the known foldable cards", () => {
    const prefs = parseAdminPrefs(
      JSON.stringify({ foldedCards: ["details", "grid", "details", 4] }),
    );
    expect(prefs.foldedCards).toEqual(["details"]);
    expect(parseAdminPrefs(JSON.stringify({ foldedCards: "coverage" })).foldedCards).toEqual([]);
  });

  it("drops an unknown theme", () => {
    expect(parseAdminPrefs(JSON.stringify({ theme: "purple" })).theme).toBeNull();
  });

  it("reads a layout and normalizes it", () => {
    const prefs = parseAdminPrefs(
      JSON.stringify({
        theme: null,
        studentLayout: { columns: [["grid", "flags"], ["notes"], ["flags"]], widths: [2, 1, 1] },
      }),
    );
    expect(prefs.studentLayout!.columns).toEqual([["grid", "flags"], ["notes"], []]);
    expect(sum(prefs.studentLayout!.widths)).toBeCloseTo(1, 2);
  });
});

describe("normalizeShares", () => {
  it("keeps shares inside the limits and summing to 1", () => {
    for (const w of [
      [1, 1, 1],
      [10, 1, 1],
      [0, 0, 5],
      [-1, Number.NaN, 2],
    ]) {
      const out = normalizeShares(w);
      expect(sum(out)).toBeCloseTo(1, 2);
      for (const x of out) {
        expect(x).toBeGreaterThanOrEqual(COLUMN_SHARE_MIN - 0.001);
        expect(x).toBeLessThanOrEqual(COLUMN_SHARE_MAX + 0.001);
      }
    }
  });
});

describe("normalizeStudentLayout", () => {
  it("keeps a card only in the first column that names it", () => {
    const out = normalizeStudentLayout({
      columns: [["a", "b"], ["b", "c"], ["a"]],
      widths: [1, 1, 1],
    });
    expect(out.columns).toEqual([["a", "b"], ["c"], []]);
  });
});
