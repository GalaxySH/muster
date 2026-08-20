// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeRunStats, type StatsStudent } from "@/lib/domain/scheduling/stats";
import type { ScheduleAssignment } from "@/lib/domain/scheduling/types";
import type { Day, ShiftBlock } from "@/lib/domain/types";
import { ScheduleHealth } from "./ScheduleHealth";

const LEAD = "shift-lead";
const NAMES = new Map([
  [LEAD, "Shift Lead"],
  ["cashier", "Cashier"],
  ["barista", "Barista"],
]);

const block = (id: string, positionId: string): ShiftBlock => ({
  id,
  positionId,
  dayType: "weekday",
  start: 480,
  end: 720,
  desiredCapacity: null,
});

const student = (email: string, overrides: Partial<StatsStudent> = {}): StatsStudent => ({
  email,
  positionId: "cashier",
  international: false,
  returner: false,
  fillIn: false,
  frozen: false,
  ...overrides,
});

const cell = (studentEmail: string, blockId: string, day: Day): ScheduleAssignment => ({
  studentEmail,
  blockId,
  day,
  cohort: "weekday",
});

/**
 * One fragile floor (a new barista alone) and one covered floor (a returning
 * cashier), staffed for one Monday each out of blocks that run five weekdays.
 * Both therefore sit at 20% coverage while their tones differ.
 */
const stats = computeRunStats({
  blocks: [block("ba", "barista"), block("ck", "cashier")],
  assignments: [cell("new@w", "ba", "mon"), cell("old@w", "ck", "mon")],
  students: [student("new@w", { positionId: "barista" }), student("old@w", { returner: true })],
  poolPositionIds: [],
  leadPositionId: LEAD,
  maxConsecutiveDays: 5,
});

/** The fill divs inside the Cover table's bars, in row order. */
function coverBars(container: HTMLElement): HTMLElement[] {
  const tables = container.querySelectorAll("table");
  const cover = tables[tables.length - 1]!;
  return [...cover.querySelectorAll<HTMLElement>("div > div")];
}

describe("the Cover table's bars", () => {
  it("draws every bar in the neutral color, whatever the row's tone", () => {
    // The bar's width means coverage now, not alarm, so painting it red would
    // say the opposite of what it measures: a full red bar would be a floor
    // that is fully staffed.
    const { container } = render(<ScheduleHealth stats={stats} positionNames={NAMES} />);
    const bars = coverBars(container);
    expect(bars.length).toBeGreaterThan(0);
    const colors = new Set(bars.map((bar) => bar.style.background));
    expect([...colors]).toEqual(["var(--color-text-info)"]);
  });

  it("sizes each bar by total coverage, not by the returner share", () => {
    const { container } = render(<ScheduleHealth stats={stats} positionNames={NAMES} />);
    // Barista is 100% solo and Cashier 0%, yet both are staffed one weekday out
    // of five, so both bars are the same 20% wide.
    expect(coverBars(container).map((bar) => bar.style.width)).toEqual([
      "20%",
      "20%",
      "20%",
      "20%",
    ]);
  });
});

describe("the stretch and fortnight sections", () => {
  it("renders the empty-shifts column beside the target fill", () => {
    render(<ScheduleHealth stats={stats} positionNames={NAMES} />);
    expect(screen.getByText("Empty shifts")).toBeInTheDocument();
    // Both floors run five weekdays and are staffed for one Monday.
    expect(screen.getAllByText("4 of 5")).toHaveLength(2);
  });

  it("gives days worked its own bars column beside the other two", () => {
    render(<ScheduleHealth stats={stats} positionNames={NAMES} />);
    expect(screen.getByText("Days in a row")).toBeInTheDocument();
    expect(screen.getByText("Days worked")).toBeInTheDocument();
    // "Weekly hours" is also a By position column header, hence both.
    expect(screen.getAllByText("Weekly hours")).toHaveLength(2);
    // The two stretch columns say different things about the same people: one
    // Monday is a run of one day, and it falls in both halves of the fortnight.
    expect(screen.getByText("1 day")).toBeInTheDocument();
    expect(screen.getByText("2 days")).toBeInTheDocument();
  });

  it("lays the fortnight out day by day, quiet where nobody is on", () => {
    render(<ScheduleHealth stats={stats} positionNames={NAMES} />);
    expect(screen.getByText("Day by day")).toBeInTheDocument();
    expect(screen.getByText("Week 1")).toBeInTheDocument();
    expect(screen.getByText("Week 2")).toBeInTheDocument();
    // Both people work the one Monday, which is the same Monday in both halves.
    expect(screen.getAllByText("2 · 8h")).toHaveLength(2);
    // Twelve quiet cells, one per slot nobody is on.
    expect(screen.getAllByText("-")).toHaveLength(12);
  });

  it("summarises the rotations under the days-in-a-row bars", () => {
    render(<ScheduleHealth stats={stats} positionNames={NAMES} />);
    expect(screen.getByText("Weekdays only: 2 people, longest 1 day")).toBeInTheDocument();
  });
});
