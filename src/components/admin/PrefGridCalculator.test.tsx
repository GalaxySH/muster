// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/availability/actions", () => ({
  saveAvailabilityFor: vi.fn(async () => ({ ok: true, errors: [] })),
}));

vi.mock("@/lib/schedule/manual", () => ({
  applyScheduleEdits: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/admin/actions", () => ({
  removeOrphanedSelection: vi.fn(async () => ({ ok: true })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PrefGridCalculator } from "./PrefGridCalculator";
import type { OrphanedCell } from "@/lib/positions/orphans";
import { saveAvailabilityFor } from "@/lib/availability/actions";
import { removeOrphanedSelection } from "@/lib/admin/actions";
import { applyScheduleEdits } from "@/lib/schedule/manual";
import { buildAdminGrid, type AssignedCellRef } from "@/lib/admin/summary";
import { demandCellKey } from "@/lib/domain/demand";
import { parseTime } from "@/lib/domain/time";
import type { Cohort } from "@/lib/domain/scheduling/types";
import type { DayType, Position, SelectedShift, ShiftBlock } from "@/lib/domain/types";

function b(id: string, dt: DayType, s: string, e: string): ShiftBlock {
  return { id, positionId: "ca", dayType: dt, start: parseTime(s), end: parseTime(e) };
}

// Round hours keep the assertions readable: each block is 4h.
const blocks: ShiftBlock[] = [
  b("wd-a", "weekday", "8a", "12p"),
  b("wd-b", "weekday", "1p", "5p"),
  b("we-a", "weekend", "9a", "1p"),
];

// An extra weekday block for the coverage rule: 9a-11a sits entirely inside
// wd-a's 8a-12p, so the two can never both be scheduled on the same day. Only
// the tests that need a conflict render with it.
const innerBlocks: ShiftBlock[] = [...blocks, b("wd-c", "weekday", "9a", "11a")];

// Two weekday picks (8h) + one weekend pick (4h). Under A/B the weekend halves,
// so the preference capacity is 8 + 2 = 10h.
const picks: SelectedShift[] = [
  { blockId: "wd-a", day: "mon" },
  { blockId: "wd-a", day: "tue" },
  { blockId: "we-a", day: "sat" },
];

const position = (minHours: number): Position => ({
  id: "ca",
  name: "Culinary Assistant",
  minHours,
  minDays: 2,
  weekendExempt: false,
});

function renderCalc(
  opts: {
    blocks?: ShiftBlock[];
    selection?: SelectedShift[];
    autoAssigned?: SelectedShift[];
    highDemand?: Set<string>;
    assignments?: AssignedCellRef[];
    everyWeekendOptIn?: boolean;
    minHours?: number;
    desiredHours?: number | null;
    cap?: number;
    scheduledMinutes?: number | null;
    scheduleCohort?: Exclude<Cohort, "weekday"> | null;
    hasCurrentRun?: boolean;
    hasSchedule?: boolean;
    isInternal?: boolean;
    studentCells?: SelectedShift[] | null;
    orphans?: OrphanedCell[];
  } = {},
) {
  const gridBlocks = opts.blocks ?? blocks;
  return render(
    <PrefGridCalculator
      grid={buildAdminGrid(
        gridBlocks,
        opts.selection ?? picks,
        opts.autoAssigned ?? [],
        opts.highDemand ?? new Set(),
        opts.assignments ?? [],
      )}
      studentEmail="stu@wisc.edu"
      blocks={gridBlocks}
      position={position(opts.minHours ?? 10)}
      desiredHours={opts.desiredHours === undefined ? 12 : opts.desiredHours}
      everyWeekendOptIn={opts.everyWeekendOptIn ?? false}
      cap={opts.cap ?? 30}
      scheduledMinutes={opts.scheduledMinutes === undefined ? null : opts.scheduledMinutes}
      scheduleCohort={opts.scheduleCohort ?? null}
      hasCurrentRun={opts.hasCurrentRun ?? false}
      hasSchedule={opts.hasSchedule ?? (opts.assignments?.length ?? 0) > 0}
      isInternal={opts.isInternal ?? false}
      studentCells={opts.studentCells ?? null}
      orphans={opts.orphans ?? []}
    />,
  );
}

beforeEach(() => {
  vi.mocked(saveAvailabilityFor).mockClear();
  vi.mocked(saveAvailabilityFor).mockResolvedValue({ ok: true, errors: [] });
  vi.mocked(applyScheduleEdits).mockClear();
  vi.mocked(applyScheduleEdits).mockResolvedValue({ ok: true });
  refresh.mockClear();
});

describe("PrefGridCalculator", () => {
  it("opens on the student's picks and reads their preference capacity", () => {
    renderCalc();
    expect(screen.getByText("10h")).toBeInTheDocument();
    // Untouched, this is their own selection, not a trial schedule yet. Anchored so
    // the "in trial schedule" legend entry doesn't satisfy it.
    expect(screen.getByText("preferred")).toBeInTheDocument();
    expect(screen.queryByText(/^trial schedule$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8a–12p Mon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reads as a trial schedule once a cell or the rotation is changed, and back after Reset", async () => {
    const user = userEvent.setup();
    renderCalc();

    await user.click(screen.getByRole("button", { name: "1p–5p Wed" })); // add a cell
    expect(screen.getByText(/^trial schedule$/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("preferred")).toBeInTheDocument();

    // The rotation alone is enough to make it a trial.
    await user.click(screen.getByRole("button", { name: /alternating/i }));
    expect(screen.getByText(/^trial schedule$/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("preferred")).toBeInTheDocument();
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

  it("rings the rotation pill only while it deviates from the student's answer", async () => {
    const user = userEvent.setup();
    renderCalc(); // student chose alternating

    const ring = () => {
      const pill = screen.getByRole("button", { name: /alternating|EVERY weekend/i });
      return pill.style.border;
    };
    expect(ring()).not.toContain("dashed"); // matches their answer

    await user.click(screen.getByRole("button", { name: /alternating/i }));
    expect(ring()).toContain("dashed"); // trial override
    expect(screen.getByRole("button", { name: /EVERY weekend/i })).toHaveAttribute(
      "title",
      expect.stringContaining("The student chose alternating"),
    );

    await user.click(screen.getByRole("button", { name: /EVERY weekend/i }));
    expect(ring()).not.toContain("dashed"); // back to their answer
  });

  it("rings the pill when an every-weekend student's rotation is flipped down to A/B", async () => {
    const user = userEvent.setup();
    renderCalc({ everyWeekendOptIn: true }); // student chose every weekend
    const pill = () => screen.getByRole("button", { name: /alternating|EVERY weekend/i });
    expect(pill().style.border).not.toContain("dashed");

    await user.click(pill());
    expect(pill().style.border).toContain("dashed");
    expect(pill()).toHaveAttribute(
      "title",
      expect.stringContaining("The student chose every weekend"),
    );
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

  it("fills the whole cell with no generated schedule, and splits once the student has one", () => {
    const { unmount } = renderCalc(); // no assignments: nothing to compare against
    expect(screen.getByRole("button", { name: "8a–12p Mon" }).style.background).not.toContain(
      "linear-gradient",
    );
    unmount();

    // A generated shift for this student brings back the diagonal preference/schedule split.
    renderCalc({
      hasCurrentRun: true,
      assignments: [{ blockId: "wd-a", day: "mon", source: "engine" }],
    });
    expect(screen.getByRole("button", { name: "8a–12p Mon" }).style.background).toContain(
      "linear-gradient",
    );
  });

  describe("the tab it opens on", () => {
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");

    it("opens on Edit schedule when there is a run", () => {
      renderCalc({ hasCurrentRun: true, scheduledMinutes: 12 * 60 });
      expect(pressed("Edit schedule")).toBe("true");
      expect(pressed("Edit preferences")).toBe("false");
      expect(screen.getByText("12h").style.fontSize).toBe("22px");
    });

    it("opens on Edit preferences before any run", () => {
      renderCalc();
      expect(pressed("Edit preferences")).toBe("true");
      expect(pressed("Edit schedule")).toBe("false");
      expect(screen.getByText("10h").style.fontSize).toBe("22px");
    });
  });

  // A read-only reminder of the saved schedule's week beside the preference
  // pill. It is not a control, so it is looked up as a note, never a button.
  describe("the scheduled week chip", () => {
    const withWeekend = (cohort: Exclude<Cohort, "weekday"> | null) => ({
      hasCurrentRun: true,
      assignments: [
        { blockId: "wd-a", day: "mon", source: "engine" } as const,
        { blockId: "we-a", day: "sat", source: "engine" } as const,
      ],
      scheduleCohort: cohort,
    });
    const chip = () => screen.queryByRole("note", { name: /^Scheduled / });

    it.each([
      ["a", "A", "Scheduled for week A"],
      ["b", "B", "Scheduled for week B"],
      ["every", "E", "Scheduled every weekend"],
    ] as const)("reads %s as %s in preferences", async (cohort, letter, label) => {
      const user = userEvent.setup();
      renderCalc(withWeekend(cohort));
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));

      const el = screen.getByRole("note", { name: label });
      expect(el).toHaveAttribute("title", label);
      expect(el).toHaveTextContent(new RegExp(`${letter}$`));
      // A label, not a control: not a button and not in the tab order.
      expect(el.tagName).toBe("SPAN");
      expect(el).not.toHaveAttribute("tabindex");
      expect(within(el).queryByRole("button")).toBeNull();
    });

    it("is gone in Edit schedule, which has the rotation controls", () => {
      renderCalc(withWeekend("a"));
      expect(chip()).toBeNull();
    });

    it("is hidden when the schedule gives them no weekend", async () => {
      const user = userEvent.setup();
      renderCalc(withWeekend(null));
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      expect(chip()).toBeNull();
    });

    it("shows the saved week, not an unsaved schedule trial", async () => {
      const user = userEvent.setup();
      renderCalc(withWeekend("a"));
      await user.click(
        within(screen.getByRole("group", { name: "Rotation week" })).getByRole("button", {
          name: "B",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      expect(chip()).toHaveAccessibleName("Scheduled for week A");
    });
  });

  describe("auto-assigned weekend range", () => {
    // Picks: weekday only (8h). The weekend is machine-assigned (we-a, 4h), so it
    // sits outside preference capacity and shows as an optional upper bound.
    const weekdayOnly: SelectedShift[] = [
      { blockId: "wd-a", day: "mon" },
      { blockId: "wd-a", day: "tue" },
    ];
    const autoSat: SelectedShift[] = [{ blockId: "we-a", day: "sat" }];

    it("shows a range while the trial's weekend is auto-only", () => {
      renderCalc({ selection: weekdayOnly, autoAssigned: autoSat });
      expect(screen.getByText("8")).toBeInTheDocument(); // picks alone
      expect(screen.getByText("–10h")).toBeInTheDocument(); // + 0.5 * 4h auto weekend
    });

    it("follows the rotation toggle", async () => {
      const user = userEvent.setup();
      renderCalc({ selection: weekdayOnly, autoAssigned: autoSat });
      expect(screen.getByText("–10h")).toBeInTheDocument(); // A/B: auto weekend at half

      await user.click(screen.getByRole("button", { name: /alternating/i }));
      expect(screen.getByText("–12h")).toBeInTheDocument(); // every weekend: in full
    });

    it("collapses to one number once a weekend shift is picked into the trial", async () => {
      const user = userEvent.setup();
      renderCalc({ selection: weekdayOnly, autoAssigned: autoSat });

      // The picked weekend shift replaces the auto one, so it is simply counted.
      await user.click(screen.getByRole("button", { name: "9a–1p Sat" }));
      expect(screen.queryByText(/^–/)).not.toBeInTheDocument();
      expect(screen.getByText("10h")).toBeInTheDocument();
    });

    it("shows no range when the student picked their own weekend shift", () => {
      renderCalc(); // picks include we-a Sat, no auto
      expect(screen.queryByText(/^–/)).not.toBeInTheDocument();
      expect(screen.getByText("10h")).toBeInTheDocument();
    });
  });

  it("marks the high-demand cell", () => {
    renderCalc({ highDemand: new Set([demandCellKey("wd-a", "mon")]) });
    expect(screen.getByRole("button", { name: "8a–12p Mon" })).toHaveAttribute(
      "title",
      expect.stringContaining("a lot of students picked this shift"),
    );
  });

  it("names the current run's assignments and their source in the cell titles", async () => {
    const user = userEvent.setup();
    renderCalc({
      assignments: [
        { blockId: "wd-a", day: "mon", source: "engine" },
        { blockId: "wd-b", day: "wed", source: "manual" },
      ],
      hasCurrentRun: true,
    });
    // The preference tab's wording; a run opens the card on the schedule tab.
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    expect(screen.getByRole("button", { name: "8a–12p Mon" })).toHaveAttribute(
      "title",
      expect.stringContaining("scheduled this run"),
    );
    expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
      "title",
      expect.stringContaining("scheduled by hand"),
    );
  });

  describe("the preferred and scheduled readouts", () => {
    // The mode decides which figure is the big one; the other stays visible as a
    // labelled miniature. Sizes are the assertion because that IS the feature.
    const sizeOf = (text: string) => screen.getByText(text).style.fontSize;

    it("keeps preferred big and scheduled miniature while editing preferences", async () => {
      const user = userEvent.setup();
      renderCalc({ hasCurrentRun: true, scheduledMinutes: 12.5 * 60 });
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      expect(sizeOf("10h")).toBe("22px");
      expect(screen.getByText("preferred")).toBeInTheDocument();
      expect(sizeOf("12.5h scheduled")).toBe("12px");
    });

    it("swaps the sizes when the admin switches to Edit schedule", async () => {
      const user = userEvent.setup();
      renderCalc({ hasCurrentRun: true, scheduledMinutes: 12.5 * 60 });
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      expect(sizeOf("10h")).toBe("22px");

      await user.click(screen.getByRole("button", { name: "Edit schedule" }));
      const figure = screen.getByText("12.5h");
      expect(figure.style.fontSize).toBe("22px");
      // Scoped to the readout: the legend says "scheduled" too, about a swatch.
      expect(within(figure.parentElement!).getByText("scheduled")).toBeInTheDocument();
      expect(sizeOf("10h preferred")).toBe("12px");
    });

    it("keeps the auto-weekend range in the miniature preferred form", () => {
      renderCalc({
        selection: [
          { blockId: "wd-a", day: "mon" },
          { blockId: "wd-a", day: "tue" },
        ],
        autoAssigned: [{ blockId: "we-a", day: "sat" }],
        hasCurrentRun: true,
        scheduledMinutes: 12.5 * 60,
      });

      // Schedule is the tab a run opens on, so preferred starts as the miniature.
      // 8h picked, up to 10h with the auto weekend: a single number would state
      // an upper bound as a fact.
      expect(screen.getByText("8–10h preferred")).toBeInTheDocument();
    });

    it("flags a scheduled week over the cap, in either size", async () => {
      const user = userEvent.setup();
      renderCalc({ cap: 20, hasCurrentRun: true, scheduledMinutes: 21 * 60 });
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      // Shrunk it still has to say why it is red: leaving preference mode must
      // not be what silences an over-cap schedule.
      const mini = screen.getByText("21h scheduled · over 20h cap");
      expect(mini.style.color).toBe("var(--color-text-danger)");

      await user.click(screen.getByRole("button", { name: "Edit schedule" }));
      const figure = screen.getByText("21h");
      expect(figure.style.color).toBe("var(--color-text-danger)");
      expect(within(figure.parentElement!).getByText("over 20h cap")).toBeInTheDocument();
    });

    it("never judges preferences against the hour cap", () => {
      // Selecting past the cap is expected and allowed (PLAN §5 #3), so the cap
      // belongs to the scheduled figure alone. These 10h of picks clear a cap of
      // 8 and the readout must not call that a problem.
      renderCalc({ cap: 8 });
      expect(sizeOf("10h")).toBe("22px");
      expect(screen.queryByText(/over 8h cap/i)).not.toBeInTheDocument();
    });

    it("flags a schedule that lands under the position floor, in either size", async () => {
      // The picks reach 10h exactly, so the only floor miss on screen is the
      // run's, which is the figure that has to carry it.
      const user = userEvent.setup();
      renderCalc({ minHours: 10, hasCurrentRun: true, scheduledMinutes: 6 * 60 });
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      const mini = screen.getByText("6h scheduled · below 10h floor");
      expect(mini.style.color).toBe("var(--color-text-warning)");

      await user.click(screen.getByRole("button", { name: "Edit schedule" }));
      const figure = screen.getByText("6h");
      expect(within(figure.parentElement!).getByText("below 10h floor")).toBeInTheDocument();
    });

    it("calls an empty schedule nothing scheduled rather than a floor miss", () => {
      renderCalc({ minHours: 10, hasCurrentRun: true, scheduledMinutes: 0 });
      expect(screen.getByText("nothing scheduled")).toBeInTheDocument();
      expect(screen.queryByText(/below 10h floor/i)).not.toBeInTheDocument();
    });

    it("holds both figures in place across the switch, moving only the emphasis", async () => {
      // Preferred first, scheduled second, in both modes. A figure that changed
      // sides as well would have to be re-found on every click.
      const user = userEvent.setup();
      const { container } = renderCalc({ hasCurrentRun: true, scheduledMinutes: 12 * 60 });
      const order = () => container.querySelector('[aria-live="polite"]')!.textContent ?? "";
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));

      expect(order().indexOf("preferred")).toBeLessThan(order().indexOf("scheduled"));
      expect(sizeOf("10h")).toBe("22px");

      await user.click(screen.getByRole("button", { name: "Edit schedule" }));

      expect(order().indexOf("preferred")).toBeLessThan(order().indexOf("scheduled"));
      expect(sizeOf("12h")).toBe("22px");
      expect(sizeOf("10h preferred")).toBe("12px");
    });

    it("says so when the run holds nothing for the student", async () => {
      const user = userEvent.setup();
      renderCalc({ hasCurrentRun: true, scheduledMinutes: 0 });
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      expect(screen.getByText("0h scheduled")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Edit schedule" }));
      const figure = screen.getByText("0h");
      expect(figure.style.fontSize).toBe("22px");
      expect(within(figure.parentElement!).getByText("nothing scheduled")).toBeInTheDocument();
    });

    it("renders no scheduled readout at all before there is a run", () => {
      renderCalc();
      expect(screen.queryByText(/scheduled$/)).toBeNull();
      expect(sizeOf("10h")).toBe("22px");
    });
  });

  describe("saving on the student's behalf", () => {
    const save = () => screen.queryByRole("button", { name: /^(Save|Saving…|Saved)$/ });

    it("offers no Save until the trial differs from the student's picks", async () => {
      const user = userEvent.setup();
      renderCalc();
      expect(save()).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      expect(save()).toHaveTextContent("Save");
    });

    it("saves the trial cells and the trial rotation for the named student", async () => {
      const user = userEvent.setup();
      renderCalc();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" })); // add a cell
      await user.click(screen.getByRole("button", { name: /alternating/i })); // and the rotation
      await user.click(save()!);

      expect(saveAvailabilityFor).toHaveBeenCalledWith("stu@wisc.edu", {
        selection: expect.arrayContaining([
          { blockId: "wd-a", day: "mon" },
          { blockId: "wd-a", day: "tue" },
          { blockId: "we-a", day: "sat" },
          { blockId: "wd-b", day: "wed" },
        ]),
        everyWeekendOptIn: true,
        overrideInvalid: false,
      });
      expect(vi.mocked(saveAvailabilityFor).mock.calls[0]![1].selection).toHaveLength(4);
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it("runs Save → Saved, and settles once the save comes back as the student's picks", async () => {
      const user = userEvent.setup();
      const { rerender } = renderCalc();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(save()!);
      await waitFor(() => expect(save()).toHaveTextContent("Saved"));
      expect(save()).toBeDisabled();

      // What the server now holds comes back as props; the trial is their selection,
      // so there is nothing left to save and the button retires.
      rerender(
        <PrefGridCalculator
          grid={buildAdminGrid(blocks, [...picks, { blockId: "wd-b", day: "wed" }], [], new Set())}
          studentEmail="stu@wisc.edu"
          blocks={blocks}
          position={position(10)}
          desiredHours={12}
          everyWeekendOptIn={false}
          cap={30}
          scheduledMinutes={null}
          scheduleCohort={null}
          hasCurrentRun={false}
          hasSchedule={false}
          isInternal={false}
          studentCells={null}
          orphans={[]}
        />,
      );
      expect(screen.getByText("preferred")).toBeInTheDocument();
      await waitFor(() => expect(save()).not.toBeInTheDocument(), { timeout: 3000 });
    });

    it("re-arms Save if the admin edits again while Saved is still up", async () => {
      const user = userEvent.setup();
      renderCalc();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(save()!);
      await waitFor(() => expect(save()).toHaveTextContent("Saved"));

      await user.click(screen.getByRole("button", { name: "1p–5p Thu" }));
      expect(save()).toHaveTextContent("Save");
      expect(save()).toBeEnabled();
    });

    it("surfaces a failed save and leaves the trial intact to retry", async () => {
      const user = userEvent.setup();
      vi.mocked(saveAvailabilityFor).mockResolvedValue({
        ok: false,
        errors: ["No position is set for this student."],
      });
      renderCalc();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(save()!);

      expect(await screen.findByText("No position is set for this student.")).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
      expect(save()).toHaveTextContent("Save");
      expect(save()).toBeEnabled();
    });

    describe("hard-rule override", () => {
      it("warns with the failing checks and saves only after Save anyway", async () => {
        const user = userEvent.setup();
        renderCalc();

        // Drop to one 4h day: below the floor and the day minimum.
        await user.click(screen.getByRole("button", { name: "8a–12p Tue" }));
        await user.click(screen.getByRole("button", { name: "9a–1p Sat" }));
        await user.click(save()!);

        expect(saveAvailabilityFor).not.toHaveBeenCalled();
        expect(screen.getByText(/does not pass the availability checks/i)).toBeInTheDocument();
        expect(screen.getByText(/of 10h minimum/i)).toBeInTheDocument();
        expect(screen.getByText(/required days selected/i)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Save anyway" }));
        expect(saveAvailabilityFor).toHaveBeenCalledWith(
          "stu@wisc.edu",
          expect.objectContaining({ overrideInvalid: true }),
        );
        await waitFor(() => expect(refresh).toHaveBeenCalled());
      });

      it("lists a missing desired-hours answer among the failing checks", async () => {
        const user = userEvent.setup();
        renderCalc({ desiredHours: null });

        await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
        await user.click(save()!);

        expect(saveAvailabilityFor).not.toHaveBeenCalled();
        expect(screen.getByText(/desired weekly hours/i)).toBeInTheDocument();
      });

      it("Keep editing dismisses the warning without saving", async () => {
        const user = userEvent.setup();
        renderCalc();

        await user.click(screen.getByRole("button", { name: "8a–12p Tue" }));
        await user.click(screen.getByRole("button", { name: "9a–1p Sat" }));
        await user.click(save()!);
        await user.click(screen.getByRole("button", { name: "Keep editing" }));

        expect(saveAvailabilityFor).not.toHaveBeenCalled();
        expect(
          screen.queryByText(/does not pass the availability checks/i),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("schedule mode", () => {
    const save = () => screen.queryByRole("button", { name: /^(Save|Saving…|Saved)$/ });
    const monEngine = [{ blockId: "wd-a", day: "mon", source: "engine" } as const];

    /** Render with one engine row on Mon; with a run the card opens in schedule mode. */
    function inScheduleMode(opts: Parameters<typeof renderCalc>[0] = {}) {
      renderCalc({ hasCurrentRun: true, assignments: [...monEngine], ...opts });
      expect(screen.getByRole("button", { name: "Edit schedule" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }

    it("stays disabled with a note before any run", () => {
      renderCalc();
      expect(screen.getByRole("button", { name: "Edit schedule" })).toBeDisabled();
      expect(
        screen.getByText("Generate a schedule first on the schedule page."),
      ).toBeInTheDocument();
    });

    it("toggles the trial locally, writing nothing until Save", async () => {
      const user = userEvent.setup();
      inScheduleMode();
      expect(
        screen.getByText(
          "Updating the schedule can replace these shifts unless the student is marked scheduled.",
        ),
      ).toBeInTheDocument();

      // An unassigned cell joins the trial, even one the student never picked.
      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // An assigned cell leaves it, engine rows included.
      await user.click(screen.getByRole("button", { name: "8a–12p Mon" }));
      expect(screen.getByRole("button", { name: "8a–12p Mon" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      expect(applyScheduleEdits).not.toHaveBeenCalled();
      expect(saveAvailabilityFor).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("Save sends the whole diff in one call", async () => {
      const user = userEvent.setup();
      inScheduleMode();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" })); // add
      await user.click(screen.getByRole("button", { name: "8a–12p Mon" })); // remove
      await user.click(save()!);

      expect(applyScheduleEdits).toHaveBeenCalledTimes(1);
      expect(applyScheduleEdits).toHaveBeenCalledWith(
        "stu@wisc.edu",
        [{ blockId: "wd-a", day: "mon" }],
        [{ blockId: "wd-b", day: "wed" }],
        // No rotation named: the admin left that control alone.
        undefined,
      );
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it("offers no Save until the trial differs, and no Clear at all", async () => {
      const user = userEvent.setup();
      inScheduleMode();
      expect(save()).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      expect(save()).toHaveTextContent("Save");
      expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    });

    it("Reset restores the run's own rows", async () => {
      const user = userEvent.setup();
      inScheduleMode();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(screen.getByRole("button", { name: "8a–12p Mon" }));
      await user.click(screen.getByRole("button", { name: "Reset" }));

      expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByRole("button", { name: "8a–12p Mon" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(save()).not.toBeInTheDocument();
      expect(applyScheduleEdits).not.toHaveBeenCalled();
    });

    it("blocks a toggle that would break the coverage rule, in the server's words", async () => {
      const user = userEvent.setup();
      // 9a-11a sits inside the Mon 8a-12p row this student already holds.
      inScheduleMode({ blocks: innerBlocks });

      await user.click(screen.getByRole("button", { name: "9a–11a Mon" }));

      expect(screen.getByText("Their Mon shifts already cover 9a to 11a.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "9a–11a Mon" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(save()).not.toBeInTheDocument(); // nothing entered the trial
      expect(applyScheduleEdits).not.toHaveBeenCalled();

      // Free the day and the same cell goes in.
      await user.click(screen.getByRole("button", { name: "8a–12p Mon" }));
      await user.click(screen.getByRole("button", { name: "9a–11a Mon" }));
      expect(screen.getByRole("button", { name: "9a–11a Mon" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("moves the scheduled figure with the trial and snaps back on Reset", async () => {
      const user = userEvent.setup();
      inScheduleMode({ scheduledMinutes: 12.5 * 60 });
      expect(screen.getByText("12.5h").style.fontSize).toBe("22px");

      // The delta is the grid's own arithmetic: one more 4h weekday cell.
      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      const figure = screen.getByText("16.5h");
      expect(figure.style.fontSize).toBe("22px");
      expect(within(figure.parentElement!).getByText("trial schedule")).toBeInTheDocument();

      // Dropping the Mon row it already holds takes those 4h back off again.
      await user.click(screen.getByRole("button", { name: "8a–12p Mon" }));
      expect(screen.getByText("12.5h")).toBeInTheDocument();
      expect(screen.getByText("trial schedule")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Reset" }));
      const clean = screen.getByText("12.5h");
      expect(within(clean.parentElement!).getByText("scheduled")).toBeInTheDocument();
    });

    it("goes loud on a trial that lands over the cap, before it is saved", async () => {
      const user = userEvent.setup();
      inScheduleMode({ cap: 20, scheduledMinutes: 19 * 60 });
      expect(screen.getByText("19h").style.color).toBe("var(--color-text-info)");

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" })); // +4h
      const figure = screen.getByText("23h");
      expect(figure.style.color).toBe("var(--color-text-danger)");
      expect(within(figure.parentElement!).getByText("over 20h cap")).toBeInTheDocument();
    });

    it("rings the pending cells and legends the cue", async () => {
      const user = userEvent.setup();
      inScheduleMode();
      expect(screen.getByText(/pending change/)).toBeInTheDocument();
      const wed = () => screen.getByRole("button", { name: "1p–5p Wed" });
      const mon = () => screen.getByRole("button", { name: "8a–12p Mon" });
      expect(wed().style.border).not.toContain("dashed");

      await user.click(wed()); // pending add: violet schedule half, dashed ring
      expect(wed().style.border).toContain("dashed");
      expect(wed().style.background).toContain("#8a4fd3");
      expect(wed().getAttribute("title")).toContain("Pending: added on Save");

      await user.click(mon()); // pending removal: empty schedule half, same ring
      expect(mon().style.border).toContain("dashed");
      expect(mon().style.background).not.toContain("#2e9e5b");
      expect(mon().getAttribute("title")).toContain("Pending: removed on Save");
    });

    it("keeps a dirty trial when the admin looks at preferences and comes back", async () => {
      const user = userEvent.setup();
      inScheduleMode();
      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));

      await user.click(screen.getByRole("button", { name: "Edit preferences" }));
      await user.click(screen.getByRole("button", { name: "Edit schedule" }));

      expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(save()).toHaveTextContent("Save");
    });

    it("shows the labor notes a save comes back with", async () => {
      const user = userEvent.setup();
      vi.mocked(applyScheduleEdits).mockResolvedValue({
        ok: true,
        warnings: ["Only 7h 30m of rest between Mon ending 11:30p and Tue starting 7a."],
      });
      inScheduleMode();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(save()!);

      expect(await screen.findByText(/Saved, but worth checking/)).toBeInTheDocument();
      expect(screen.getByText(/Only 7h 30m of rest/)).toBeInTheDocument();
      // Warn only: the batch landed and the grid re-reads as usual.
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it("clears a stale labor note once a Save comes back clean", async () => {
      const user = userEvent.setup();
      vi.mocked(applyScheduleEdits).mockResolvedValue({
        ok: true,
        warnings: ["Only 7h 30m of rest between Mon ending 11:30p and Tue starting 7a."],
      });
      inScheduleMode();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(save()!);
      expect(await screen.findByText(/Saved, but worth checking/)).toBeInTheDocument();

      // The "Saved" receipt retires itself; the note does not, so the next Save
      // is what has to take it down. It describes a week that is no longer the
      // one on screen.
      vi.mocked(applyScheduleEdits).mockResolvedValue({ ok: true });
      await waitFor(() => expect(save()).toBeEnabled(), { timeout: 3000 });
      await user.click(save()!);

      await waitFor(() => expect(screen.queryByText(/Saved, but worth checking/)).toBeNull());
    });

    it("re-arms Save and says so when the action throws rather than refusing", async () => {
      const user = userEvent.setup();
      // Not an { ok: false } refusal: a dropped connection, a row another admin
      // got to first. startTransition swallows the throw, so the button would
      // otherwise sit disabled on "Saving…" with nothing on screen to explain it.
      vi.mocked(applyScheduleEdits).mockRejectedValue(new Error("connection reset"));
      inScheduleMode();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(save()!);

      expect(await screen.findByText(/Could not save those changes/)).toBeInTheDocument();
      expect(save()).toHaveTextContent("Save");
      expect(save()).toBeEnabled();
      expect(refresh).not.toHaveBeenCalled();
      // The composition survives, the same as after a refusal.
      expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("leaves a trial that lands exactly on the cap unflagged, and flags a minute past it", async () => {
      const user = userEvent.setup();
      // The cap comparison is in minutes with the over-max flag's own epsilon
      // (domain/scheduling/problems.ts), so sitting exactly on the cap is never
      // over it and the cue can never disagree with the schedule page's pill.
      const { unmount } = renderCalc({
        hasCurrentRun: true,
        assignments: [{ blockId: "wd-a", day: "mon", source: "engine" }],
        cap: 20,
        scheduledMinutes: 16 * 60,
      });
      await user.click(screen.getByRole("button", { name: "1p–5p Wed" })); // +4h: exactly 20h
      const onCap = screen.getByText("20h");
      expect(onCap.style.color).not.toBe("var(--color-text-danger)");
      expect(within(onCap.parentElement!).queryByText("over 20h cap")).toBeNull();
      unmount();

      // One minute past. The figure still reads 20h (it rounds; the comparison
      // does not), which is exactly what the server would flag.
      renderCalc({
        hasCurrentRun: true,
        assignments: [{ blockId: "wd-a", day: "mon", source: "engine" }],
        cap: 20,
        scheduledMinutes: 20 * 60 + 1,
      });
      const over = screen.getByText("20h");
      expect(over.style.color).toBe("var(--color-text-danger)");
      expect(within(over.parentElement!).getByText("over 20h cap")).toBeInTheDocument();
    });

    it("keeps the trial when the save is refused, so the named cell can be fixed", async () => {
      const user = userEvent.setup();
      vi.mocked(applyScheduleEdits).mockResolvedValue({
        ok: false,
        error: "Mon 9a to 11a: Their Mon shifts already cover 9a to 11a.",
      });
      inScheduleMode();

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      await user.click(save()!);

      expect(
        await screen.findByText("Mon 9a to 11a: Their Mon shifts already cover 9a to 11a."),
      ).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(save()).toHaveTextContent("Save");
      expect(save()).toBeEnabled();
    });

    it("keeps preference clicks off the schedule action", async () => {
      const user = userEvent.setup();
      renderCalc({ hasCurrentRun: true });
      await user.click(screen.getByRole("button", { name: "Edit preferences" }));

      await user.click(screen.getByRole("button", { name: "1p–5p Wed" }));
      expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(applyScheduleEdits).not.toHaveBeenCalled();
    });

    // The rotation the run puts their weekend on, which is a different fact
    // from the rotation their availability is offered under: the pill here
    // moves the schedule, the one in preference mode moves the answer.
    describe("the weekend rotation", () => {
      /** One engine weekday row plus a Sat row in the given rotation week. */
      const withWeekend = (cohort: Exclude<Cohort, "weekday">) => ({
        assignments: [
          { blockId: "wd-a", day: "mon", source: "engine" } as const,
          { blockId: "we-a", day: "sat", source: "engine" } as const,
        ],
        scheduleCohort: cohort,
      });
      const pill = () => screen.getByRole("button", { name: /alternating|EVERY weekend/i });
      const week = (name: "A" | "B") =>
        within(screen.getByRole("group", { name: "Rotation week" })).getByRole("button", { name });

      it("reads the run's own rotation, not the student's answer", async () => {
        const user = userEvent.setup();
        // The student answered alternating; the run put them on every weekend.
        inScheduleMode({ ...withWeekend("every"), everyWeekendOptIn: false });
        expect(pill()).toHaveTextContent("EVERY weekend");
        expect(screen.queryByRole("group", { name: "Rotation week" })).not.toBeInTheDocument();

        // And the preference pill beside it still reads their own answer.
        await user.click(screen.getByRole("button", { name: "Edit preferences" }));
        expect(pill()).toHaveTextContent("alternating");
      });

      it("offers the A and B weeks only while the schedule is alternating", async () => {
        const user = userEvent.setup();
        inScheduleMode(withWeekend("b"));
        expect(week("B")).toHaveAttribute("aria-pressed", "true");
        expect(week("A")).toHaveAttribute("aria-pressed", "false");

        await user.click(pill()); // to every weekend: both weeks, nothing to pick
        expect(screen.queryByRole("group", { name: "Rotation week" })).not.toBeInTheDocument();

        // Back off every-weekend lands on the week the run recorded.
        await user.click(pill());
        expect(week("B")).toHaveAttribute("aria-pressed", "true");
      });

      it("counts the weekend whole once the schedule moves to every weekend", async () => {
        const user = userEvent.setup();
        inScheduleMode({ ...withWeekend("a"), scheduledMinutes: 12 * 60 });
        expect(screen.getByText("12h").style.fontSize).toBe("22px");

        // Their 4h Sat row counted half under A/B and counts whole under every.
        await user.click(pill());
        const figure = screen.getByText("14h");
        expect(within(figure.parentElement!).getByText("trial schedule")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Reset" }));
        const clean = screen.getByText("12h");
        expect(within(clean.parentElement!).getByText("scheduled")).toBeInTheDocument();
      });

      it("leaves the preferred figure alone, since it answers a different question", async () => {
        const user = userEvent.setup();
        inScheduleMode({ ...withWeekend("a"), scheduledMinutes: 12 * 60 });
        expect(screen.getByText("10h preferred")).toBeInTheDocument();

        await user.click(pill());
        expect(screen.getByText("10h preferred")).toBeInTheDocument();
      });

      it("saves the rotation with the batch and rings the pill until it lands", async () => {
        const user = userEvent.setup();
        inScheduleMode(withWeekend("a"));
        expect(pill().style.border).not.toContain("dashed");

        await user.click(week("B"));
        expect(pill().style.border).toContain("dashed");
        await user.click(save()!);

        expect(applyScheduleEdits).toHaveBeenCalledWith("stu@wisc.edu", [], [], "b");
        await waitFor(() => expect(refresh).toHaveBeenCalled());
      });

      it("names the rotation for the new weekend rows of the same batch", async () => {
        const user = userEvent.setup();
        inScheduleMode(withWeekend("a"));

        await user.click(pill()); // every weekend
        await user.click(screen.getByRole("button", { name: "9a–1p Sun" })); // and a new row
        await user.click(save()!);

        expect(applyScheduleEdits).toHaveBeenCalledWith(
          "stu@wisc.edu",
          [],
          [{ blockId: "we-a", day: "sun" }],
          "every",
        );
      });

      it("is not a change when the run has no weekend shift to move", async () => {
        const user = userEvent.setup();
        // Weekday rows only, so the pill has nothing to put in either week.
        inScheduleMode();
        await user.click(pill());
        expect(save()).not.toBeInTheDocument();
      });
    });
  });

  describe("internal diff cues", () => {
    // The grid shows the saved internal copy: Mon kept from the student, Wed
    // added by the admin. The student's own cells were Mon and Tue.
    const internalSel: SelectedShift[] = [
      { blockId: "wd-a", day: "mon" },
      { blockId: "wd-b", day: "wed" },
    ];
    const studentCells: SelectedShift[] = [
      { blockId: "wd-a", day: "mon" },
      { blockId: "wd-a", day: "tue" },
    ];

    it("marks admin-added cells and dropped student cells", () => {
      renderCalc({ selection: internalSel, isInternal: true, studentCells });
      // Added by the admin: called out as not the student's pick.
      expect(screen.getByRole("button", { name: "1p–5p Wed" })).toHaveAttribute(
        "title",
        expect.stringContaining("not one the student picked"),
      );
      // Dropped from the copy: still the student's, offered back.
      expect(screen.getByRole("button", { name: "8a–12p Tue" })).toHaveAttribute(
        "title",
        expect.stringContaining("not in the saved copy"),
      );
      // A cell the copy kept carries no diff cue.
      expect(screen.getByRole("button", { name: "8a–12p Mon" }).getAttribute("title")).toBe(
        "In trial schedule",
      );
      // The legend explains both rings.
      expect(screen.getByText(/not picked by the student/)).toBeInTheDocument();
      expect(screen.getByText(/their pick, not in this copy/)).toBeInTheDocument();
    });

    it("clears the dropped cue once the cell is added back to the trial", async () => {
      const user = userEvent.setup();
      renderCalc({ selection: internalSel, isInternal: true, studentCells });

      await user.click(screen.getByRole("button", { name: "8a–12p Tue" }));
      expect(screen.getByRole("button", { name: "8a–12p Tue" }).getAttribute("title")).toBe(
        "In trial schedule",
      );
    });

    it("shows no diff cues without an internal copy", () => {
      renderCalc();
      expect(screen.queryByText(/not picked by the student/)).not.toBeInTheDocument();
      expect(screen.queryByText(/their pick, not in this copy/)).not.toBeInTheDocument();
    });
  });

  describe("orphaned picks (removed shifts)", () => {
    // A retired weekday shift the student had picked on Mon and Wed.
    const orphans: OrphanedCell[] = [
      {
        blockId: "gone",
        day: "mon",
        dayType: "weekday",
        start: parseTime("6a"),
        end: parseTime("10a"),
        label: "Mon 6a–10a",
        retired: true,
        fromStudent: true,
        fromInternal: false,
      },
      {
        blockId: "gone",
        day: "wed",
        dayType: "weekday",
        start: parseTime("6a"),
        end: parseTime("10a"),
        label: "Wed 6a–10a",
        retired: true,
        fromStudent: true,
        fromInternal: false,
      },
    ];

    const orphanCell = (day: string) =>
      screen.getByRole("button", { name: `6a–10a ${day} on a removed shift` });

    it("renders one row per removed shift, marked and struck through", () => {
      renderCalc({ orphans });
      expect(screen.getByText("removed")).toBeInTheDocument();
      // Every day of the sub-grid gets a cell, picked or not.
      for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
        expect(orphanCell(d)).toBeInTheDocument();
      }
    });

    it("disables every cell the student did not pick, so nothing can be added", () => {
      renderCalc({ orphans });
      expect(orphanCell("Tue")).toBeDisabled();
      expect(orphanCell("Thu")).toBeDisabled();
      expect(orphanCell("Tue").getAttribute("title")).toBe(
        "This shift was removed. It can't be picked.",
      );
    });

    it("leaves the picked cells clickable, to clear them", () => {
      renderCalc({ orphans });
      expect(orphanCell("Mon")).toBeEnabled();
      expect(orphanCell("Wed")).toBeEnabled();
      expect(orphanCell("Mon").getAttribute("title")).toBe(
        "This shift was removed. Click to clear this pick.",
      );
    });

    it("clearing a picked cell calls the remove action for that exact cell", async () => {
      const user = userEvent.setup();
      renderCalc({ orphans });

      await user.click(orphanCell("Wed"));
      await waitFor(() =>
        expect(removeOrphanedSelection).toHaveBeenCalledWith("stu@wisc.edu", "gone", "wed"),
      );
      // The server owns the outcome, so the page re-reads rather than guessing.
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it("never counts an orphaned pick toward the hours readout", () => {
      // The two orphaned Mon/Wed cells are 4h each. If they counted at all, the
      // 10h capacity would move; a removed shift is not availability.
      renderCalc({ orphans });
      expect(screen.getByText("10h")).toBeInTheDocument();
    });

    it("shows no removed row when there are no orphans", () => {
      renderCalc();
      expect(screen.queryByText("removed")).not.toBeInTheDocument();
    });
  });

  // A pick preserved through a position change looks the same as a retired one
  // (dead, visible, clearable) but is NOT the same thing, and telling the admin
  // the shift "was removed" would be a plain lie: it still exists, on the
  // position this student no longer holds.
  describe("orphaned picks (a position the student left)", () => {
    const orphans: OrphanedCell[] = [
      {
        blockId: "dishwasher-wd-6a-10a",
        day: "mon",
        dayType: "weekday",
        start: parseTime("6a"),
        end: parseTime("10a"),
        label: "Mon 6a–10a",
        retired: false,
        fromStudent: true,
        fromInternal: false,
      },
    ];

    const cell = (day: string) =>
      screen.getByRole("button", { name: `6a–10a ${day} on a old position shift` });

    it("tags the row as an old position rather than a removal", () => {
      renderCalc({ orphans });
      expect(screen.getByText("old position")).toBeInTheDocument();
      expect(screen.queryByText("removed")).not.toBeInTheDocument();
    });

    it("explains why the pick is dead without claiming the shift is gone", () => {
      renderCalc({ orphans });
      expect(cell("Mon").getAttribute("title")).toBe(
        "This shift is on the position they used to hold. Click to clear this pick.",
      );
      expect(cell("Tue").getAttribute("title")).toBe(
        "This shift is on the position they used to hold. It can't be picked.",
      );
    });

    it("keeps the pick clearable, so the admin decides when it goes", () => {
      renderCalc({ orphans });
      expect(cell("Mon")).toBeEnabled();
      expect(cell("Tue")).toBeDisabled();
    });

    it("never counts it toward the hours readout", () => {
      renderCalc({ orphans });
      expect(screen.getByText("10h")).toBeInTheDocument();
    });
  });
});
