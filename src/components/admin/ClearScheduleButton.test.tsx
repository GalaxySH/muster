// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/schedule/actions", () => ({ clearScheduleRun: vi.fn() }));

import { clearScheduleRun } from "@/lib/schedule/actions";
import { ClearScheduleButton } from "./ClearScheduleButton";

describe("ClearScheduleButton", () => {
  beforeEach(() => {
    vi.mocked(clearScheduleRun).mockReset();
    vi.mocked(clearScheduleRun).mockResolvedValue({ ok: true, unmarked: 0 });
  });

  it("asks first and clears nothing until confirmed", async () => {
    const user = userEvent.setup();
    render(<ClearScheduleButton markedScheduled={3} />);

    await user.click(screen.getByRole("button", { name: "Clear schedule" }));
    expect(clearScheduleRun).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(clearScheduleRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear schedule" })).toBeTruthy();
  });

  it("unmarks the scheduled students by default", async () => {
    const user = userEvent.setup();
    render(<ClearScheduleButton markedScheduled={3} />);

    await user.click(screen.getByRole("button", { name: "Clear schedule" }));
    const box = screen.getByRole("checkbox", { name: "Also unmark 3 students as scheduled" });
    expect((box as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Yes, clear" }));
    expect(clearScheduleRun).toHaveBeenCalledWith(true);
  });

  it("keeps the marks when the box is unticked", async () => {
    const user = userEvent.setup();
    render(<ClearScheduleButton markedScheduled={1} />);

    await user.click(screen.getByRole("button", { name: "Clear schedule" }));
    await user.click(screen.getByRole("checkbox", { name: "Also unmark 1 student as scheduled" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear" }));
    expect(clearScheduleRun).toHaveBeenCalledWith(false);
  });

  it("offers nothing to unmark when no one is marked", async () => {
    const user = userEvent.setup();
    render(<ClearScheduleButton markedScheduled={0} />);

    await user.click(screen.getByRole("button", { name: "Clear schedule" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the failure instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(clearScheduleRun).mockResolvedValue({ ok: false, error: "Admins only." });
    render(<ClearScheduleButton markedScheduled={0} />);

    await user.click(screen.getByRole("button", { name: "Clear schedule" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear" }));
    expect((await screen.findByRole("status")).textContent).toBe("Admins only.");
  });
});
