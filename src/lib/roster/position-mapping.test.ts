import { describe, it, expect } from "vitest";
import {
  buildEffectiveTitleMap,
  diffTitleList,
  effectiveExcludedTitles,
  normalizeTitleList,
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

  it("strips accents, so a Café title matches however the export encoded it", () => {
    expect(normalizeTitle("Retail and Café Team Member")).toBe("retail and cafe team member");
  });
});

describe("SKIP_TITLES", () => {
  it("covers both spellings of the Dining Advisory Board title", () => {
    // The tracker renamed "Advisor" to "Advisory"; missing that let DAB members
    // through as students with no position.
    for (const title of [
      "Dining Advisory Board Member (DAB)",
      "Dining Advisor Board Member (DAB)",
    ]) {
      expect(SKIP_TITLES.has(normalizeTitle(title))).toBe(true);
    }
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

describe("normalizeTitleList", () => {
  it("trims, lowercases, and collapses whitespace per line", () => {
    expect(normalizeTitleList("  Dining Advisor   Board Member (DAB) \n")).toEqual([
      "dining advisor board member (dab)",
    ]);
  });

  it("drops blank lines and de-duplicates case-insensitively", () => {
    expect(normalizeTitleList("Volunteer\n\n  \nVOLUNTEER\nvolunteer \nGuest")).toEqual([
      "volunteer",
      "guest",
    ]);
  });

  it("returns [] for empty input", () => {
    expect(normalizeTitleList("")).toEqual([]);
    expect(normalizeTitleList("  \n \n")).toEqual([]);
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

describe("diffTitleList", () => {
  it("reports titles the position takes on and gives up", () => {
    const diff = diffTitleList(["cashier", "old title"], "Cashier\nBarista");
    expect(diff.titles).toEqual(["cashier", "barista"]);
    expect(diff.added).toEqual(["barista"]);
    expect(diff.removed).toEqual(["old title"]);
  });

  it("treats a re-cased or re-spaced title as unchanged", () => {
    const diff = diffTitleList(["retail and cafe team member"], "  Retail and   Cafe Team Member ");
    expect(diff.titles).toEqual(["retail and cafe team member"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("normalizes stored titles too, so a hand-written row still matches", () => {
    expect(diffTitleList(["Retail and Café Team Member"], "retail and cafe team member")).toEqual({
      titles: ["retail and cafe team member"],
      added: [],
      removed: [],
    });
  });

  it("removes every title when the box is cleared", () => {
    const diff = diffTitleList(["cashier", "barista"], "");
    expect(diff.titles).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["barista", "cashier"]);
  });

  it("adds every title when nothing is stored yet", () => {
    const diff = diffTitleList([], "Cashier\n\nBarista\n");
    expect(diff.added).toEqual(["cashier", "barista"]);
    expect(diff.removed).toEqual([]);
  });
});
