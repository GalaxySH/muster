import { describe, it, expect } from "vitest";
import {
  buildEffectiveTitleMap,
  effectiveExcludedTitles,
  normalizeExcludedTitles,
  normalizeTitle,
  SKIP_TITLES,
} from "./position-mapping";

const POSITIONS = [
  { id: "cashier", mergedIntoId: null },
  { id: "market-cashier", mergedIntoId: "cashier" },
  { id: "dishwasher", mergedIntoId: null },
];

describe("normalizeTitle", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeTitle("  CULINARY   assistant \n")).toBe("culinary assistant");
  });
});

describe("buildEffectiveTitleMap", () => {
  it("passes plain mappings through with normalized keys", () => {
    const map = buildEffectiveTitleMap([{ title: "Cashier ", positionId: "cashier" }], POSITIONS);
    expect(map.get("cashier")).toBe("cashier");
    expect(map.size).toBe(1);
  });

  it("resolves a mapping that points at an alias to the canonical position", () => {
    const map = buildEffectiveTitleMap(
      [{ title: "market cashier", positionId: "market-cashier" }],
      POSITIONS,
    );
    expect(map.get("market cashier")).toBe("cashier");
  });

  it("treats a mapping whose position row is missing as unmapped", () => {
    const map = buildEffectiveTitleMap(
      [
        { title: "ghost role", positionId: "deleted-position" },
        { title: "dishwasher", positionId: "dishwasher" },
      ],
      POSITIONS,
    );
    expect(map.has("ghost role")).toBe(false);
    expect(map.get("dishwasher")).toBe("dishwasher");
  });

  it("returns an empty map for no mappings", () => {
    expect(buildEffectiveTitleMap([], POSITIONS).size).toBe(0);
  });
});

describe("normalizeExcludedTitles", () => {
  it("trims, lowercases, and collapses whitespace per line", () => {
    expect(normalizeExcludedTitles("  Dining Advisor   Board Member (DAB) \n")).toEqual([
      "dining advisor board member (dab)",
    ]);
  });

  it("drops blank lines and de-duplicates case-insensitively", () => {
    expect(normalizeExcludedTitles("Volunteer\n\n  \nVOLUNTEER\nvolunteer \nGuest")).toEqual([
      "volunteer",
      "guest",
    ]);
  });

  it("returns [] for empty input", () => {
    expect(normalizeExcludedTitles("")).toEqual([]);
    expect(normalizeExcludedTitles("  \n \n")).toEqual([]);
  });
});

describe("effectiveExcludedTitles", () => {
  it("falls back to the SKIP_TITLES fixture when the setting was never saved", () => {
    const set = effectiveExcludedTitles(null);
    expect(set).toEqual(SKIP_TITLES);
    expect(set.has("dining advisor board member (dab)")).toBe(true);
  });

  it("uses the stored list instead of the fixture once saved", () => {
    const set = effectiveExcludedTitles("Volunteer\nGuest Worker");
    expect([...set]).toEqual(["volunteer", "guest worker"]);
    expect(set.has("dining advisor board member (dab)")).toBe(false);
  });

  it("treats a stored empty list as excluding nothing", () => {
    expect(effectiveExcludedTitles("").size).toBe(0);
  });

  it("normalizes stored titles for case-insensitive comparison", () => {
    expect(effectiveExcludedTitles("  GUEST   Worker ").has("guest worker")).toBe(true);
  });
});
