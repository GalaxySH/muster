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
  cohort: null,
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

  it("names the cell by its day and shift, with the count the title gives", () => {
    renderCell([], 4);
    const cell = screen.getByRole("button");
    expect(cell).toHaveAccessibleName("Mon, 8a to 12p: 4 could work this shift");
    expect(cell).toHaveAttribute("title", "4 could work this shift");
  });

  it("lists the people the count is made of", async () => {
    renderCell([person({ email: "amy@wisc.edu", displayName: "Amy Ames" })]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Amy Ames")).toBeTruthy());
    expect(screen.getByText("1 can work it")).toBeTruthy();
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
    expect(screen.getByText("2 can work it · 1 on this shift")).toBeTruthy();
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

  it("says which rotation week each weekend assignment is in", async () => {
    // A weekend cell mixes both weeks, and its count reads "a·b", so the list
    // has to say which of the two each person is actually working.
    renderCell([
      person({ email: "amy@wisc.edu", displayName: "Amy Ames", assignedHere: true, cohort: "a" }),
      person({ email: "boyd@wisc.edu", displayName: "Boyd Bell", assignedHere: true, cohort: "b" }),
      person({
        email: "cyd@wisc.edu",
        displayName: "Cyd Cole",
        assignedHere: true,
        cohort: "every",
      }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Cyd Cole")).toBeTruthy());
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).queryByText("week A")).toBeTruthy();
    expect(within(rows[1]!).queryByText("week B")).toBeTruthy();
    expect(within(rows[2]!).queryByText("every weekend")).toBeTruthy();
  });

  it("lists the people the run put on the shift first", async () => {
    renderCell([
      person({ email: "amy@wisc.edu", displayName: "Amy Ames" }),
      person({ email: "boyd@wisc.edu", displayName: "Boyd Bell", assignedHere: true }),
      person({ email: "cyd@wisc.edu", displayName: "Cyd Cole" }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Cyd Cole")).toBeTruthy());
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual([
      "Boyd Bell",
      "Amy Ames",
      "Cyd Cole",
    ]);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      "/admin/students/boyd%40wisc.edu",
    );
  });

  it("names the position and marks who is scheduled and auto-assigned", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      data: {
        blockId: "b",
        day: "sat",
        people: [person({ email: "amy@wisc.edu", scheduled: true, autoAssigned: true })],
      },
    });
    render(
      <table>
        <tbody>
          <tr>
            <SlotCell
              blockId="b"
              day="sat"
              dayLabel="Sat"
              shiftLabel="8:45a to 12:30p"
              supply={1}
              positionName="Cashier"
            >
              1
            </SlotCell>
          </tr>
        </tbody>
      </table>,
    );
    await userEvent.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog", { name: "8:45a to 12:30p on Sat" });
    expect(within(dialog).getByText("Cashier · 1 can work it")).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByText("scheduled")).toBeTruthy());
    expect(within(dialog).getByText("auto weekend")).toBeTruthy();
  });

  it("shows the error the fetch came back with", async () => {
    fetchMock.mockResolvedValue({ ok: false, error: "Could not load that shift." });
    render(
      <table>
        <tbody>
          <tr>
            <SlotCell blockId="b" day="mon" dayLabel="Mon" shiftLabel="8a to 12p" supply={2}>
              2
            </SlotCell>
          </tr>
        </tbody>
      </table>,
    );
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load that shift.");
  });

  it("labels the group of people who are on the shift without offering it", async () => {
    renderCell([
      person({ email: "amy@wisc.edu", displayName: "Amy Ames" }),
      person({
        email: "cyd@wisc.edu",
        displayName: "Cyd Cole",
        offered: false,
        assignedHere: true,
        source: "manual",
      }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Cyd Cole")).toBeTruthy());
    const more = screen.getByRole("list", { name: "1 more person is on this shift" });
    expect(within(more).getByText("Cyd Cole")).toBeTruthy();
    expect(within(more).queryByText("Amy Ames")).toBeNull();
  });

  it("tags no rotation on a weekday cell, or on someone the run does not place", async () => {
    renderCell([
      person({
        email: "amy@wisc.edu",
        displayName: "Amy Ames",
        assignedHere: true,
        cohort: "weekday",
      }),
      person({ email: "boyd@wisc.edu", displayName: "Boyd Bell" }),
    ]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Boyd Bell")).toBeTruthy());
    expect(screen.queryByText(/^week [AB]$/)).toBeNull();
    expect(screen.queryByText("every weekend")).toBeNull();
  });
});
