import { describe, expect, it } from "vitest";
import { COLUMN_SHARE_MAX, COLUMN_SHARE_MIN, type StudentLayout } from "./preferences-shape";
import {
  DEFAULT_STUDENT_LAYOUT,
  arrangeCards,
  completeLayout,
  moveCard,
  resizeColumns,
  stepTarget,
} from "./student-board";

const ALL = DEFAULT_STUDENT_LAYOUT.columns.flat();
const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);

const defaults: StudentLayout = {
  columns: [["a", "b", "c"], ["d", "e"], ["f"]],
  widths: [0.4, 0.3, 0.3],
};

describe("DEFAULT_STUDENT_LAYOUT", () => {
  it("names every card once and keeps the old 1.55 to 1 to 1 widths", () => {
    expect(new Set(ALL).size).toBe(11);
    const [l, m, r] = DEFAULT_STUDENT_LAYOUT.widths;
    expect(l / m).toBeCloseTo(1.55, 1);
    expect(m).toBeCloseTo(r, 3);
  });
});

describe("arrangeCards", () => {
  it("uses the defaults with no saved layout, skipping cards that do not render", () => {
    expect(arrangeCards(null, defaults, ["a", "c", "d", "f"])).toEqual([["a", "c"], ["d"], ["f"]]);
  });

  it("follows the saved order", () => {
    const saved: StudentLayout = {
      columns: [["f", "a"], ["c", "b", "d"], ["e"]],
      widths: [0.3, 0.4, 0.3],
    };
    expect(arrangeCards(saved, defaults, "abcdef".split(""))).toEqual([
      ["f", "a"],
      ["c", "b", "d"],
      ["e"],
    ]);
  });

  it("drops saved ids the page no longer has", () => {
    const saved: StudentLayout = {
      columns: [
        ["gone", "a", "b", "c"],
        ["d", "e"],
        ["f", "old"],
      ],
      widths: [1, 1, 1],
    };
    expect(arrangeCards(saved, defaults, "abcdef".split(""))).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
      ["f"],
    ]);
  });

  it("puts a card the saved layout lacks after its default neighbour", () => {
    // b is new; its default neighbour a now sits in the right column.
    const saved: StudentLayout = { columns: [["c"], ["d", "e"], ["a", "f"]], widths: [1, 1, 1] };
    // a is not in the left column any more, so b goes before c, which follows it there.
    expect(arrangeCards(saved, defaults, "abcdef".split(""))).toEqual([
      ["b", "c"],
      ["d", "e"],
      ["a", "f"],
    ]);
    const saved2: StudentLayout = { columns: [["c", "a"], ["d", "e"], ["f"]], widths: [1, 1, 1] };
    expect(arrangeCards(saved2, defaults, "abcdef".split(""))).toEqual([
      ["c", "a", "b"],
      ["d", "e"],
      ["f"],
    ]);
  });

  it("puts a card at the end of its default column when it has no neighbour there", () => {
    const saved: StudentLayout = { columns: [[], ["d", "a", "b"], ["f"]], widths: [1, 1, 1] };
    // c and e are new. None of c's default neighbours (a, b) is in the left
    // column, so it goes at the end; e follows d, its neighbour.
    expect(arrangeCards(saved, defaults, "abcdef".split(""))).toEqual([
      ["c"],
      ["d", "e", "a", "b"],
      ["f"],
    ]);
  });
});

describe("completeLayout", () => {
  it("clamps the saved widths", () => {
    const out = completeLayout({ columns: [[], [], []], widths: [10, 1, 1] }, defaults);
    expect(sum(out.widths)).toBeCloseTo(1, 2);
    expect(Math.max(...out.widths)).toBeLessThanOrEqual(COLUMN_SHARE_MAX + 0.001);
  });

  it("returns a copy of the defaults it can change freely", () => {
    const out = completeLayout(null, defaults);
    out.columns[0].push("x");
    expect(defaults.columns[0]).toEqual(["a", "b", "c"]);
  });
});

describe("moveCard", () => {
  const cols = defaults.columns;

  it("moves up past the visible card above, not a hidden one", () => {
    // b does not render: c going up lands above a.
    const present = ["a", "c", "d", "e", "f"];
    const to = stepTarget(cols, present, "c", "up")!;
    expect(to).toEqual({ column: 0, index: 0 });
    expect(moveCard(cols, present, "c", to.column, to.index)[0]).toEqual(["c", "a", "b"]);
  });

  it("moves down and across", () => {
    const present = "abcdef".split("");
    const down = stepTarget(cols, present, "a", "down")!;
    expect(moveCard(cols, present, "a", down.column, down.index)[0]).toEqual(["b", "a", "c"]);
    const right = stepTarget(cols, present, "b", "right")!;
    expect(right).toEqual({ column: 1, index: 1 });
    expect(moveCard(cols, present, "b", right.column, right.index)).toEqual([
      ["a", "c"],
      ["d", "b", "e"],
      ["f"],
    ]);
  });

  it("can drop into an empty column", () => {
    const empty: StudentLayout["columns"] = [["a"], [], ["f"]];
    expect(moveCard(empty, ["a", "f"], "a", 1, 0)).toEqual([[], ["a"], ["f"]]);
  });

  it("has no move past an edge", () => {
    const present = "abcdef".split("");
    expect(stepTarget(cols, present, "a", "up")).toBeNull();
    expect(stepTarget(cols, present, "c", "down")).toBeNull();
    expect(stepTarget(cols, present, "a", "left")).toBeNull();
    expect(stepTarget(cols, present, "f", "right")).toBeNull();
  });
});

describe("resizeColumns", () => {
  it("changes only the two neighbours, inside the limits", () => {
    const w: StudentLayout["widths"] = [0.4, 0.3, 0.3];
    const out = resizeColumns(w, 0, 0.1);
    expect(out).toEqual([0.5, 0.2, 0.3]);
    const far = resizeColumns(w, 0, 0.5);
    expect(far[1]).toBeCloseTo(COLUMN_SHARE_MIN, 3);
    expect(far[2]).toBeCloseTo(0.3, 3);
    const back = resizeColumns(w, 1, -1);
    expect(back[1]).toBeCloseTo(COLUMN_SHARE_MIN, 3);
    expect(back[2]).toBeCloseTo(0.4, 3);
    expect(sum(back)).toBeCloseTo(1, 3);
  });
});
