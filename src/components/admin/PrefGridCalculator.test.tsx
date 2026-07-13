// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PrefGridCalculator } from "./PrefGridCalculator";
import { buildAdminGrid } from "@/lib/admin/summary";
import { demandCellKey } from "@/lib/domain/demand";
import { parseTime } from "@/lib/domain/time";
import type { DayType, SelectedShift, ShiftBlock } from "@/lib/domain/types";

function b(id: string, dt: DayType, s: string, e: string): ShiftBlock {
  return { id, positionId: "ca", dayType: dt, start: parseTime(s), end: parseTime(e) };
}

// Round hours keep the assertions readable: each block is 4h.
const blocks: ShiftBlock[] = [
  b("wd-a", "weekday", "8a", "12p"),
  b("wd-b", "weekday", "1p", "5p"),
  b("we-a", "weekend", "9a", "1p"),
];

// Two weekday picks (8h) + one weekend pick (4h). Under A/B the weekend halves,
// so the preference capacity is 8 + 2 = 10h.
const picks: SelectedShift[] = [
  { blockId: "wd-a", day: "mon" },
  { blockId: "wd-a", day: "tue" },
  { blockId: "we-a", day: "sat" },
];

function renderCalc(
  opts: {
    selection?: SelectedShift[];
    autoAssigned?: SelectedShift[];
    highDemand?: Set<string>;
    everyWeekendOptIn?: boolean;
    minHours?: number;
    cap?: number;
  } = {},
) {
  return render(
    <PrefGridCalculator
      grid={buildAdminGrid(
        blocks,
        opts.selection ?? picks,
        opts.autoAssigned ?? [],
        opts.highDemand ?? new Set(),
      )}
      blocks={blocks}
      everyWeekendOptIn={opts.everyWeekendOptIn ?? false}
      minHours={opts.minHours ?? 10}
      cap={opts.cap ?? 30}
    />,
  );
}

describe("PrefGridCalculator", () => {
  it("opens on the student's picks and reads their preference capacity", () => {
    renderCalc();
    expect(screen.getByText("10h")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8a–12p Mon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("recomputes the hours live as cells are toggled, flagging the floor", async () => {
    const user = userEvent.setup();
    renderCalc();

    await user.click(screen.getByRole("button", { name: "8a–12p Tue" })); // remove a pick
    expect(screen.getByText("6h")).toBeInTheDocument();
    expect(screen.getByText(/below 10h floor/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "8a–12p Tue" })); // add it back
    expect(screen.getByText("10h")).toBeInTheDocument();
  });

  it("cycle-averages the weekend at half under A/B and full with the opt-in", () => {
    const { unmount } = renderCalc();
    expect(screen.getByText("10h")).toBeInTheDocument(); // 8h weekday + 0.5 * 4h weekend
    unmount();

    renderCalc({ everyWeekendOptIn: true });
    expect(screen.getByText("12h")).toBeInTheDocument(); // 8h weekday + 1.0 * 4h weekend
    expect(screen.getByText("EVERY weekend")).toBeInTheDocument();
  });

  it("re-weights the weekend when the rotation pill is clicked", async () => {
    const user = userEvent.setup();
    renderCalc(); // A/B: 8h weekday + 0.5 * 4h weekend = 10h
    expect(screen.getByText("10h")).toBeInTheDocument();

    const pill = screen.getByRole("button", { name: /alternating/i });
    expect(pill).toHaveAttribute("aria-pressed", "false");

    await user.click(pill); // flip to every-weekend: the weekend now counts in full
    expect(screen.getByText("12h")).toBeInTheDocument();
    const flipped = screen.getByRole("button", { name: /EVERY weekend/i });
    expect(flipped).toHaveAttribute("aria-pressed", "true");

    await user.click(flipped); // and back
    expect(screen.getByText("10h")).toBeInTheDocument();
  });

  it("Reset restores the student's real rotation, not just the picks", async () => {
    const user = userEvent.setup();
    renderCalc();

    await user.click(screen.getByRole("button", { name: /alternating/i }));
    expect(screen.getByText("12h")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("10h")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /alternating/i })).toBeInTheDocument();
  });

  it("Clear empties the trial and Reset restores the picks", async () => {
    const user = userEvent.setup();
    renderCalc();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("0h")).toBeInTheDocument();
    expect(screen.getByText(/no shifts picked/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("10h")).toBeInTheDocument();
  });

  it("flags a cell the student never offered once it is added to the trial", async () => {
    const user = userEvent.setup();
    renderCalc();
    const cell = screen.getByRole("button", { name: "1p–5p Wed" });
    expect(cell).toHaveAttribute("title", expect.stringContaining("Click to add"));

    await user.click(cell);
    expect(cell).toHaveAttribute("aria-pressed", "true");
    expect(cell).toHaveAttribute("title", expect.stringContaining("not one the student picked"));
  });

  it("marks the high-demand cell", () => {
    renderCalc({ highDemand: new Set([demandCellKey("wd-a", "mon")]) });
    expect(screen.getByRole("button", { name: "8a–12p Mon" })).toHaveAttribute(
      "title",
      expect.stringContaining("a lot of students picked this shift"),
    );
  });
});
