// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/schedule/actions", () => ({
  fetchCellAvailability: vi.fn(),
}));
// The hover card fetches on its own; nothing here exercises it.
vi.mock("@/lib/admin/student-schedule-actions", () => ({
  fetchStudentSchedule: vi.fn(),
}));

import { SlotCell } from "./SlotCell";
import { fetchCellAvailability } from "@/lib/schedule/actions";
import type { CellPerson } from "@/lib/schedule/data";

const fetchMock = vi.mocked(fetchCellAvailability);

const person = (overrides: Partial<CellPerson> & { email: string }): CellPerson => ({
  displayName: overrides.email,
  positionName: "Cashier",
  autoAssigned: false,
  offered: true,
  assignedHere: false,
  source: null,
  scheduled: false,
  ...overrides,
});

function renderCell(people: CellPerson[], supply = people.filter((p) => p.offered).length) {
  fetchMock.mockResolvedValue({ ok: true, data: { blockId: "b", day: "mon", people } });
  return render(
    <table>
      <tbody>
        <tr>
          <SlotCell
            blockId="b"
            day="mon"
            dayLabel="Mon"
            shiftLabel="8a to 12p"
            supply={supply}
            style={{}}
          >
            {supply}
          </SlotCell>
        </tr>
      </tbody>
    </table>,
  );
}

describe("SlotCell dialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the people the count is made of", async () => {
    renderCell([person({ email: "amy@wisc.edu", displayName: "Amy Ames" })]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Amy Ames")).toBeTruthy());
    expect(screen.getByText("1 person can work this shift")).toBeTruthy();
  });

  it("shows someone scheduled here who never offered the shift", async () => {
    // The bug: the dialog was built only from the availability set, so a
    // hand-placed student or a fill-in was simply missing from the list of
    // people working the shift.
    renderCell([
      person({ email: "amy@wisc.edu", displayName: "Amy Ames" }),
      person({
        email: "boyd@wisc.edu",
        displayName: "Boyd Bell",
        offered: false,
        assignedHere: true,
        source: "manual",
      }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Boyd Bell")).toBeTruthy());
    expect(screen.getByText("1 more person is on this shift")).toBeTruthy();
  });

  it("marks a hand-placed assignment as manual", async () => {
    renderCell([
      person({
        email: "boyd@wisc.edu",
        displayName: "Boyd Bell",
        offered: false,
        assignedHere: true,
        source: "manual",
      }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Boyd Bell")).toBeTruthy());
    expect(screen.getByText("manual")).toBeTruthy();
  });

  it("does not call an engine placement manual", async () => {
    renderCell([
      person({
        email: "cyd@wisc.edu",
        displayName: "Cyd Cole",
        offered: false,
        assignedHere: true,
        source: "engine",
      }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Cyd Cole")).toBeTruthy());
    expect(screen.queryByText("manual")).toBeNull();
  });

  it("keeps the count and the offered list in step when extra people are shown", async () => {
    // The header explains the grid's number, so the also-scheduled group must
    // not inflate it.
    renderCell(
      [
        person({ email: "amy@wisc.edu", displayName: "Amy Ames" }),
        person({ email: "boyd@wisc.edu", displayName: "Boyd Bell" }),
        person({
          email: "cyd@wisc.edu",
          displayName: "Cyd Cole",
          offered: false,
          assignedHere: true,
          source: "manual",
        }),
      ],
      2,
    );
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Cyd Cole")).toBeTruthy());
    expect(screen.getByText("2 people can work this shift")).toBeTruthy();
  });

  it("says nobody offered it while still showing who is on it", async () => {
    renderCell(
      [
        person({
          email: "cyd@wisc.edu",
          displayName: "Cyd Cole",
          offered: false,
          assignedHere: true,
          source: "manual",
        }),
      ],
      0,
    );
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Cyd Cole")).toBeTruthy());
    expect(screen.getByText("Nobody has offered this shift.")).toBeTruthy();
  });

  it("only says 'on this shift' for someone who offered it", async () => {
    // In the also-scheduled group the heading already said it.
    renderCell([
      person({ email: "amy@wisc.edu", displayName: "Amy Ames", assignedHere: true }),
      person({
        email: "cyd@wisc.edu",
        displayName: "Cyd Cole",
        offered: false,
        assignedHere: true,
        source: "engine",
      }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Cyd Cole")).toBeTruthy());
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).queryByText("on this shift")).toBeTruthy();
    expect(within(rows[1]!).queryByText("on this shift")).toBeNull();
  });
});
