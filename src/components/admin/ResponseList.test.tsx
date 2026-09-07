// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The row's two controls reach server actions, which drag in `server-only`.
vi.mock("@/lib/admin/actions", () => ({ deleteResponse: vi.fn() }));
vi.mock("@/lib/admin/student-schedule-actions", () => ({ fetchStudentSchedule: vi.fn() }));

import { ResponseList } from "./ResponseList";
import { DEFAULT_SORT } from "@/lib/admin/response-sort";
import type { ResponseRow } from "@/lib/admin/data";

const row = (over: Partial<ResponseRow> & { email: string; displayName: string }): ResponseRow => ({
  positionId: "cashier",
  positionName: "Cashier",
  status: "submitted",
  scheduled: false,
  desiredHours: 15,
  onRoster: true,
  groupId: "returners",
  groupName: "Returners",
  scheduledMinutes: null,
  hiredOn: null,
  flagTypes: [],
  flagCount: 0,
  openChangeRequests: 0,
  submittedAt: new Date("2026-08-05T12:00:00Z"),
  updatedAt: new Date("2026-08-05T12:00:00Z"),
  ...over,
});

const cellFor = (name: string, label: string) => {
  const cell = screen.getByText(name).closest("tr")!.querySelector(`td[data-label="${label}"]`);
  return cell as HTMLElement;
};

describe("ResponseList", () => {
  it("names the student's group, and calls out an ungrouped one", () => {
    render(
      <ResponseList
        rows={[
          row({ email: "amy@wisc.edu", displayName: "Amy Ames" }),
          row({ email: "boyd@wisc.edu", displayName: "Boyd Barr", groupId: null, groupName: null }),
        ]}
        initialSort={DEFAULT_SORT}
      />,
    );
    expect(cellFor("Amy Ames", "Group")).toHaveTextContent("Returners");
    expect(cellFor("Boyd Barr", "Group")).toHaveTextContent("no group");
  });

  it("shows scheduled hours against requested only once the run holds shifts", () => {
    render(
      <ResponseList
        rows={[
          // 12.5h of the 15 they asked for.
          row({ email: "amy@wisc.edu", displayName: "Amy Ames", scheduledMinutes: 750 }),
          row({ email: "boyd@wisc.edu", displayName: "Boyd Barr" }),
        ]}
        initialSort={DEFAULT_SORT}
      />,
    );
    expect(cellFor("Amy Ames", "Hours")).toHaveTextContent("12.5/15h");
    expect(cellFor("Boyd Barr", "Hours")).toHaveTextContent(/^15h$/);
  });

  it("shows scheduled hours for a student nobody has marked scheduled", () => {
    // The run is what says how many hours somebody has; the mark is separate.
    render(
      <ResponseList
        rows={[
          row({
            email: "amy@wisc.edu",
            displayName: "Amy Ames",
            scheduled: false,
            scheduledMinutes: 600,
          }),
        ]}
        initialSort={DEFAULT_SORT}
      />,
    );
    expect(cellFor("Amy Ames", "Hours")).toHaveTextContent("10/15h");
    expect(cellFor("Amy Ames", "Scheduled")).not.toHaveTextContent("Scheduled");
  });

  it("labels the scheduled mark rather than ticking it", () => {
    render(
      <ResponseList
        rows={[row({ email: "amy@wisc.edu", displayName: "Amy Ames", scheduled: true })]}
        initialSort={DEFAULT_SORT}
      />,
    );
    expect(cellFor("Amy Ames", "Scheduled")).toHaveTextContent("Scheduled");
  });

  it("gives every row a trigger for the current-run shift popup", () => {
    render(
      <ResponseList
        rows={[row({ email: "amy@wisc.edu", displayName: "Amy Ames" })]}
        initialSort={DEFAULT_SORT}
      />,
    );
    expect(
      within(cellFor("Amy Ames", "Name")).getByRole("button", {
        name: "Scheduled shifts for Amy Ames",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the filters on screen when nothing matches, so they can be changed", () => {
    render(
      <ResponseList
        rows={[]}
        initialSort={DEFAULT_SORT}
        filters={<div>filter controls</div>}
        emptyMessage="No one matches this filter."
      />,
    );
    expect(screen.getByText("filter controls")).toBeInTheDocument();
    expect(screen.getByText("No one matches this filter.")).toBeInTheDocument();
  });
});
