// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// The cells are SlotCells, which fetch their people on click; nothing here clicks.
vi.mock("@/lib/schedule/actions", () => ({ fetchCellAvailability: vi.fn() }));
vi.mock("@/lib/admin/student-schedule-actions", () => ({ fetchStudentSchedule: vi.fn() }));

import { CoverageGrid } from "./CoverageGrid";
import { buildCoverageRows } from "@/lib/domain/scheduling/coverage";
import { demandCellKey } from "@/lib/domain/demand";
import type { AssignedCellCounts } from "@/lib/schedule/data";
import type { ShiftBlock } from "@/lib/domain/types";

const block = (over: Partial<ShiftBlock> & { id: string }): ShiftBlock => ({
  positionId: "cashier",
  dayType: "weekday",
  start: 11 * 60,
  end: 14 * 60,
  desiredCapacity: 2,
  ...over,
});

const WEEKDAY = block({ id: "wd" });
const WEEKEND = block({ id: "we", dayType: "weekend", start: 17 * 60, end: 20 * 60 });

/** Rows for the two blocks, with `counts` takers on the cells named. */
function rows(counts: Record<string, number> = {}) {
  return buildCoverageRows(
    [WEEKDAY, WEEKEND],
    Object.entries(counts).map(([key, count]) => {
      const [blockId, day] = key.split("|");
      return { blockId: blockId!, day: day as "mon", count };
    }),
  );
}

/** The one block row's cell under `dayLabel`. Columns and cells line up 1:1. */
const cellOf = (table: HTMLElement, dayLabel: string) => {
  const column = within(table)
    .getAllByRole("columnheader")
    .findIndex((th) => th.textContent === dayLabel);
  const row = within(table).getAllByRole("row")[1]!;
  return within(row).getAllByRole("cell")[column]!;
};

const weekdayTable = () => screen.getAllByRole("table")[0]!;
const weekendTable = () => screen.getAllByRole("table")[1]!;

describe("CoverageGrid", () => {
  it("counts who could work each cell when no run is passed", () => {
    render(<CoverageGrid rows={rows({ "wd|mon": 3, "wd|tue": 1 })} assignedCells={null} />);

    // count/target, graded: 3 of 2 meets the target, 1 of 2 is short.
    expect(cellOf(weekdayTable(), "Mon")).toHaveTextContent("3/2");
    expect(cellOf(weekdayTable(), "Tue")).toHaveTextContent("1/2");
    expect(cellOf(weekdayTable(), "Wed")).toHaveTextContent("0/2");
  });

  it("counts the run's seats when one is passed, and both rotation weeks on the weekend", () => {
    const assigned = new Map<string, AssignedCellCounts>([
      [demandCellKey("wd", "mon"), { a: 2, b: 2 }],
      [demandCellKey("we", "sat"), { a: 2, b: 1 }],
    ]);
    render(<CoverageGrid rows={rows({ "wd|mon": 9, "we|sat": 9 })} assignedCells={assigned} />);

    // The supply (9) is the tooltip's business; the cell shows the seats filled.
    expect(cellOf(weekdayTable(), "Mon")).toHaveTextContent("2/2");
    expect(cellOf(weekendTable(), "Sat")).toHaveTextContent("2·1/2");
  });

  /** The flex box holding both day-type tables: table → scroll wrapper → layout. */
  const layoutOf = () => weekdayTable().parentElement!.parentElement!;

  it("sets the two tables side by side by default", () => {
    render(<CoverageGrid rows={rows()} assignedCells={null} />);
    expect(layoutOf()).not.toHaveStyle({ flexDirection: "column" });
    expect(layoutOf()).toHaveStyle({ flexWrap: "wrap" });
  });

  it("stacks weekdays above weekends when asked, each table scrolling on its own", () => {
    render(<CoverageGrid rows={rows()} assignedCells={null} stacked />);
    expect(layoutOf()).toHaveStyle({ flexDirection: "column" });
    expect(weekendTable().parentElement!.parentElement).toBe(layoutOf());
    const headings = within(layoutOf())
      .getAllByRole("heading")
      .map((h) => h.textContent);
    expect(headings).toEqual(["Weekdays", "Weekends"]);
    for (const table of [weekdayTable(), weekendTable()]) {
      expect(table.parentElement).toHaveStyle({ overflowX: "auto" });
    }
  });

  it("says so when the position has no blocks", () => {
    render(<CoverageGrid rows={[]} assignedCells={null} />);
    expect(screen.getByText("No blocks configured.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
