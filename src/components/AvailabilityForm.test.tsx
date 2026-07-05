// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/availability/actions", () => ({
  saveAvailability: vi.fn(async () => ({ ok: true, errors: [] })),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
  opts: {
    preview?: boolean;
    blocks?: ShiftBlock[];
    international?: boolean;
    status?: "draft" | "submitted" | null;
  } = {},
) {
  const blocks = opts.blocks ?? defaultBlocks;
  return render(
    <AvailabilityForm
      position={position}
      blocks={blocks}
      gridModel={buildGridModel(blocks)}
      international={opts.international ?? false}
      initialSelection={[]}
      initialAutoAssigned={[]}
      initialEveryWeekendOptIn={false}
      initialDesiredHours={null}
      initialNotes=""
      initialStatus={opts.status ?? null}
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

  it("requires both passing rules and desired hours before continuing", async () => {
    const user = userEvent.setup();
    renderForm();
    const cont = screen.getByRole("button", { name: "Save and continue" });
    expect(cont).toBeDisabled();

    // Satisfy the availability hard rules.
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    await user.click(screen.getByRole("button", { name: "8:30a–11a Sat" }));

    // Still blocked: desired hours is required.
    expect(cont).toBeDisabled();
    expect(screen.getByText(/enter your desired weekly hours/i)).toBeInTheDocument();

    await user.type(screen.getByRole("spinbutton"), "14");
    expect(cont).toBeEnabled();

    await user.click(cont);
    expect(saveAvailability).toHaveBeenCalledTimes(1);
    expect(saveAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "continue", desiredHours: 14 }),
    );
    // Successful "continue" advances to the travel step.
    expect(push).toHaveBeenCalledWith("/travel");
  });

  it("blocks continuing when desired hours is below the position minimum", async () => {
    const user = userEvent.setup();
    renderForm();
    const cont = screen.getByRole("button", { name: "Save and continue" });

    // Satisfy the availability hard rules.
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    await user.click(screen.getByRole("button", { name: "8:30a–11a Sat" }));

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input).toHaveAttribute("min", "10");

    await user.type(input, "5");
    expect(cont).toBeDisabled();
    expect(screen.getByText(/at least 10h/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "10");
    expect(cont).toBeEnabled();
  });

  it("treats a missing weekend shift as a soft warning, not a hard block", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    await user.type(screen.getByRole("spinbutton"), "12");

    expect(screen.getByRole("button", { name: "Save and continue" })).toBeEnabled();
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

  it("reflects a server-side weekend auto-assignment when saving an already-submitted form", async () => {
    const user = userEvent.setup();
    vi.mocked(saveAvailability).mockResolvedValueOnce({
      ok: true,
      autoAssigned: { blockId: "we-open", day: "sat", label: "Sat 8:30a–11a" },
      errors: [],
    });
    renderForm({ status: "submitted" }); // edit mode → "Save changes", stays on page

    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Tue" }));
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Wed" }));
    await user.type(screen.getByRole("spinbutton"), "12");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/we kept one for you/i)).toBeInTheDocument();
    const autoCell = screen.getByRole("button", { name: "8:30a–11a Sat" });
    expect(autoCell).toHaveTextContent("★");
    expect(autoCell).toHaveAttribute("title", expect.stringContaining("auto-assigned"));
    expect(autoCell).toHaveAttribute("aria-pressed", "false"); // server-owned, not a manual pick
    expect(push).not.toHaveBeenCalled(); // editing in place — no wizard advance
  });

  it("arms the tab-close warning only while there are unsaved changes", async () => {
    const user = userEvent.setup();
    renderForm();
    const fireBeforeUnload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };

    expect(fireBeforeUnload()).toBe(false); // pristine

    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    expect(fireBeforeUnload()).toBe(true); // dirty

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft saved.");
    expect(fireBeforeUnload()).toBe(false); // saved → clean again
  });

  it("confirms before leaving via a link while there are unsaved changes", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<a href="/course-schedule">Course schedule</a>);
    renderForm();
    const link = screen.getByRole("link", { name: "Course schedule" });
    // Reached only when the guard lets the click through; swallows the default
    // so jsdom doesn't attempt a real navigation.
    let passedThrough = 0;
    link.addEventListener("click", (e) => {
      passedThrough += 1;
      e.preventDefault();
    });

    // Pristine form: no prompt, the click goes through.
    await user.click(link);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(passedThrough).toBe(1);

    // Dirty + decline: prompted, navigation blocked.
    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" }));
    await user.click(link);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(passedThrough).toBe(1);

    // Accept: prompted, the click goes through.
    confirmSpy.mockReturnValue(true);
    await user.click(link);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(passedThrough).toBe(2);

    confirmSpy.mockRestore();
  });

  it("does not prompt for new-tab navigations (target=_blank, modified clicks)", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <>
        <a href="/travel">Same tab</a>
        <a href="/help" target="_blank">
          New tab
        </a>
      </>,
    );
    renderForm();
    for (const name of ["Same tab", "New tab"]) {
      screen.getByRole("link", { name }).addEventListener("click", (e) => e.preventDefault());
    }

    await user.click(screen.getByRole("button", { name: "6:30a–10:15a Mon" })); // dirty

    await user.click(screen.getByRole("link", { name: "New tab" }));
    fireEvent.click(screen.getByRole("link", { name: "Same tab" }), { ctrlKey: true });
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
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
