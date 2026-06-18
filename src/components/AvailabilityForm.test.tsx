// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/availability/actions", () => ({
  saveAvailability: vi.fn(async () => ({ ok: true, status: "submitted", errors: [] })),
}));

import { AvailabilityForm } from "./AvailabilityForm";
import { saveAvailability } from "@/lib/availability/actions";
import { buildGridModel } from "@/lib/availability/grid";
import { parseTime } from "@/lib/domain/time";
import type { Position, ShiftBlock } from "@/lib/domain/types";

function b(id: string, dt: "weekday" | "weekend", s: string, e: string): ShiftBlock {
  return {
    id,
    positionId: "ca",
    dayType: dt,
    start: parseTime(s),
    end: parseTime(e),
    highDemand: false,
  };
}

const blocks: ShiftBlock[] = [
  b("wd-open", "weekday", "6:30a", "10:15a"),
  b("wd-close", "weekday", "7:45p", "11:30p"),
  b("we-open", "weekend", "8:30a", "11a"),
];

const position: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};

function renderForm() {
  return render(
    <AvailabilityForm
      position={position}
      blocks={blocks}
      gridModel={buildGridModel(blocks)}
      initialSelection={[]}
      initialEveryWeekendOptIn={false}
      initialDesiredHours={null}
      initialStatus={null}
    />,
  );
}

describe("AvailabilityForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders weekday and weekend grids with day columns", () => {
    renderForm();
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    expect(screen.getByText("Weekend")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Mon" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Sat" })).toBeInTheDocument();
  });

  it("toggles a cell's pressed state on click", async () => {
    const user = userEvent.setup();
    renderForm();
    const cell = screen.getByRole("button", { name: "6:30a–10:15a Mon" });
    expect(cell).toHaveAttribute("aria-pressed", "false");
    await user.click(cell);
    expect(cell).toHaveAttribute("aria-pressed", "true");
    await user.click(cell);
    expect(cell).toHaveAttribute("aria-pressed", "false");
  });

  it("disables Submit until hard rules pass, then submits the selection", async () => {
    const user = userEvent.setup();
    renderForm();
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();

    // open block on 3 weekdays + a weekend shift clears min-hours/open/days/weekend.
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    await user.click(screen.getByRole("button", { name: "8:30a–11a Sat" }));

    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(saveAvailability).toHaveBeenCalledTimes(1);
    expect(saveAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ submit: true, everyWeekendOptIn: false }),
    );
    const arg = vi.mocked(saveAvailability).mock.calls[0]![0];
    expect(arg.selection).toHaveLength(4);
  });

  it("flags a missing weekend shift as a soft warning, not a hard block", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    // No weekend selected: submit still allowed (soft), warning shown.
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    expect(screen.getByText(/no weekend shift/i)).toBeInTheDocument();
  });
});
