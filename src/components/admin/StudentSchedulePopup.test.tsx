// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/schedule/student-schedule-actions", () => ({
  fetchStudentSchedule: vi.fn(),
}));

import {
  StudentScheduleModalLink,
  StudentScheduleHover,
} from "./StudentSchedulePopup";
import { fetchStudentSchedule } from "@/lib/schedule/student-schedule-actions";
import type { StudentScheduleView } from "@/lib/schedule/student-schedule-data";
import { buildStudentScheduleGrid } from "@/lib/admin/student-schedule-view";
import { parseTime } from "@/lib/domain/time";

const fetchMock = vi.mocked(fetchStudentSchedule);

function view(overrides: Partial<StudentScheduleView> = {}): StudentScheduleView {
  const grid = buildStudentScheduleGrid(
    [
      { id: "wd", dayType: "weekday", start: parseTime("8a"), end: parseTime("12p"), retired: false },
      { id: "we", dayType: "weekend", start: parseTime("9a"), end: parseTime("1p"), retired: false },
    ],
    [
      { blockId: "wd", day: "mon", cohort: "weekday", source: "engine" },
      { blockId: "we", day: "sat", cohort: "a", source: "manual" },
    ],
  );
  return {
    email: "amy@wisc.edu",
    displayName: "Amy Ames",
    positionName: "Cashier",
    scheduled: true,
    grid,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, data: view() });
});

describe("StudentScheduleModalLink", () => {
  it("fetches on click and shows the grid, the mark, and rotation letters", async () => {
    const user = userEvent.setup();
    render(
      <StudentScheduleModalLink email="amy@wisc.edu" displayName="Amy Ames">
        2 shifts
      </StudentScheduleModalLink>,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "2 shifts" }));
    expect(fetchMock).toHaveBeenCalledWith("amy@wisc.edu");

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByText("8a–12p")).toBeInTheDocument());
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("✓ scheduled")).toBeInTheDocument();
    // The weekend cell letters its rotation; the title carries the details.
    expect(screen.getByTitle("Sat 9a–1p, rotation A, by hand")).toHaveTextContent("A");
  });

  it("shows the action's error instead of a grid", async () => {
    fetchMock.mockResolvedValue({ ok: false, error: "No schedule has been generated yet." });
    const user = userEvent.setup();
    render(
      <StudentScheduleModalLink email="amy@wisc.edu" displayName="Amy Ames">
        2 shifts
      </StudentScheduleModalLink>,
    );
    await user.click(screen.getByRole("button", { name: "2 shifts" }));
    await waitFor(() =>
      expect(screen.getByText("No schedule has been generated yet.")).toBeInTheDocument(),
    );
  });

  it("fetches once across reopen", async () => {
    const user = userEvent.setup();
    render(
      <StudentScheduleModalLink email="amy@wisc.edu" displayName="Amy Ames">
        2 shifts
      </StudentScheduleModalLink>,
    );
    await user.click(screen.getByRole("button", { name: "2 shifts" }));
    await screen.findByText("8a–12p");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "2 shifts" }));
    await screen.findByText("8a–12p");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("StudentScheduleHover", () => {
  it("starts the fetch on hover and floats the card after the delay", async () => {
    const user = userEvent.setup();
    render(
      <StudentScheduleHover email="amy@wisc.edu">
        <a href="/admin/students/amy%40wisc.edu">Amy Ames</a>
      </StudentScheduleHover>,
    );
    await user.hover(screen.getByText("Amy Ames"));
    expect(fetchMock).toHaveBeenCalledWith("amy@wisc.edu");
    await screen.findByRole("tooltip");
    await waitFor(() => expect(screen.getByText("8a–12p")).toBeInTheDocument());
  });

  it("hides the card again on unhover", async () => {
    const user = userEvent.setup();
    render(
      <StudentScheduleHover email="amy@wisc.edu">
        <a href="/admin/students/amy%40wisc.edu">Amy Ames</a>
      </StudentScheduleHover>,
    );
    // The card repeats the name, so hold the trigger element rather than re-querying.
    const name = screen.getByText("Amy Ames");
    await user.hover(name);
    await screen.findByRole("tooltip");
    await user.unhover(name);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });
});
