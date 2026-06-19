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

const defaultBlocks: ShiftBlock[] = [
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

function renderForm(
  opts: { preview?: boolean; blocks?: ShiftBlock[]; international?: boolean } = {},
) {
  const blocks = opts.blocks ?? defaultBlocks;
  return render(
    <AvailabilityForm
      position={position}
      blocks={blocks}
      gridModel={buildGridModel(blocks)}
      international={opts.international ?? false}
      initialSelection={[]}
      initialEveryWeekendOptIn={false}
      initialDesiredHours={null}
      initialStatus={null}
      preview={opts.preview}
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

  it("requires both passing rules and desired hours before submit", async () => {
    const user = userEvent.setup();
    renderForm();
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();

    // Satisfy the availability hard rules.
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    await user.click(screen.getByRole("button", { name: "8:30a–11a Sat" }));

    // Still blocked: desired hours is required.
    expect(submit).toBeDisabled();
    expect(screen.getByText(/enter your desired weekly hours/i)).toBeInTheDocument();

    await user.type(screen.getByRole("spinbutton"), "14");
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(saveAvailability).toHaveBeenCalledTimes(1);
    expect(saveAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ submit: true, desiredHours: 14 }),
    );
  });

  it("treats a missing weekend shift as a soft warning, not a hard block", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    await user.type(screen.getByRole("spinbutton"), "12");

    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    expect(screen.getByText(/no weekend shift/i)).toBeInTheDocument();
  });

  it("marks a shorter shift as covered when a longer overlapping shift is selected", async () => {
    const user = userEvent.setup();
    renderForm({
      blocks: [
        b("wd-open", "weekday", "6:30a", "10:15a"),
        b("wd-long", "weekday", "10a", "2p"),
        b("wd-short", "weekday", "10a", "12:45p"),
      ],
    });
    const short = screen.getByRole("button", { name: "10a–12:45p Mon" });
    expect(short).not.toHaveAttribute("title");

    await user.click(screen.getByRole("button", { name: "10a–2p Mon" }));

    expect(short).toHaveAttribute("title", expect.stringContaining("covered"));
    expect(short).toHaveTextContent("–");
    expect(short).toHaveAttribute("aria-pressed", "false"); // covered, not selected
  });

  it("fills desired hours from the Min/Max shortcuts (cap depends on intl status)", async () => {
    const user = userEvent.setup();
    const { unmount } = renderForm(); // domestic: cap 30
    const input = () => screen.getByRole("spinbutton") as HTMLInputElement;

    await user.click(screen.getByRole("button", { name: "Min (10h)" }));
    expect(input().value).toBe("10");
    await user.click(screen.getByRole("button", { name: "Max (30h)" }));
    expect(input().value).toBe("30");
    unmount();

    renderForm({ international: true }); // cap 20
    expect(screen.getByRole("button", { name: "Max (20h)" })).toBeInTheDocument();
  });

  it("in preview mode shows a banner and never persists", async () => {
    const user = userEvent.setup();
    renderForm({ preview: true });
    expect(screen.getByText(/admin preview/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(saveAvailability).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing saved/i)).toBeInTheDocument();
  });
});
