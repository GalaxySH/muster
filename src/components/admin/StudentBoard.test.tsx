// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { StudentLayout } from "@/lib/admin/preferences-shape";

const save = vi.fn();
vi.mock("@/lib/admin/preferences-actions", () => ({
  saveStudentLayout: (...args: unknown[]) => save(...args),
}));

import { StudentBoard, type BoardCard } from "./StudentBoard";
import { ARRANGE_BUTTON_ID, setArranging, useArrangeState } from "./arrange-store";

/** The rail's Arrange cards button (AdminNav), reduced to what the board talks to. */
function Rail() {
  const { available, arranging } = useArrangeState();
  if (!available) return null;
  return (
    <button
      id={ARRANGE_BUTTON_ID}
      type="button"
      aria-pressed={arranging}
      onClick={() => setArranging(!arranging)}
    >
      Arrange cards
    </button>
  );
}

const defaults: StudentLayout = {
  columns: [["grid", "flags"], ["course", "travel"], ["notes"]],
  widths: [0.4, 0.3, 0.3],
};

const card = (id: string, title: string): BoardCard => ({
  id,
  title,
  node: <section>{`${title} content`}</section>,
});
const ALL = [
  card("grid", "Grid"),
  card("flags", "Flags"),
  card("course", "Course"),
  card("travel", "Travel"),
  card("notes", "Notes"),
];

/** The card titles in each rendered column, by the column's layout number. */
function columnTitles(container: HTMLElement): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  container.querySelectorAll<HTMLElement>("[data-column]").forEach((col) => {
    out[col.dataset.column!] = [...col.querySelectorAll<HTMLElement>("[data-card]")].map(
      (c) => c.dataset.card!,
    );
  });
  return out;
}

const advance = () =>
  act(async () => {
    vi.advanceTimersByTime(500);
  });

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
  save.mockResolvedValue({ ok: true });
  // A root of its own, as the rail is outside the page's tree.
  render(<Rail />);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("StudentBoard", () => {
  it("renders the columns in the saved order", () => {
    const saved: StudentLayout = {
      columns: [["travel"], ["flags", "grid"], ["notes", "course"]],
      widths: [0.3, 0.4, 0.3],
    };
    const { container } = render(
      <StudentBoard cards={ALL} defaultLayout={defaults} savedLayout={saved} />,
    );
    expect(columnTitles(container)).toEqual({
      "1": ["travel"],
      "2": ["flags", "grid"],
      "3": ["notes", "course"],
    });
    // No arranging controls until asked for.
    expect(screen.queryByRole("button", { name: /move/i })).toBeNull();
  });

  it("drops an empty column, and shows it again while arranging", () => {
    const { container } = render(
      <StudentBoard
        cards={ALL.filter((c) => c.id !== "notes")}
        defaultLayout={defaults}
        savedLayout={null}
      />,
    );
    expect(Object.keys(columnTitles(container))).toEqual(["1", "2"]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange cards" }));
    expect(Object.keys(columnTitles(container))).toEqual(["1", "2", "3"]);
    expect(screen.getByText("Drop cards here")).toBeInTheDocument();
  });

  it("moves a card with its buttons, keeps focus on it, announces it and saves", async () => {
    const { container } = render(
      <StudentBoard cards={ALL} defaultLayout={defaults} savedLayout={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Arrange cards" }));
    expect(screen.getByText("Travel content").closest("[inert]")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Move Travel up" }));
    expect(columnTitles(container)["2"]).toEqual(["travel", "course"]);
    // At the top now, so focus goes to the next move it can make.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Travel down" }));
    expect(screen.getByText("Travel moved to column 2, position 1.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move Travel right" }));
    expect(columnTitles(container)["3"]).toEqual(["travel", "notes"]);
    // The last column has no right, so focus moves to a move it can still make.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Travel down" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Travel left" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Travel left" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Travel right" }));
    expect(save).not.toHaveBeenCalled();

    await advance();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toEqual({
      columns: [["grid", "flags"], ["course"], ["travel", "notes"]],
      widths: [0.4, 0.3, 0.3],
    });
  });

  it("resets to the default and saves null", async () => {
    const saved: StudentLayout = {
      columns: [["notes"], ["grid", "flags"], ["course", "travel"]],
      widths: [0.3, 0.4, 0.3],
    };
    const { container } = render(
      <StudentBoard cards={ALL} defaultLayout={defaults} savedLayout={saved} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Arrange cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(columnTitles(container)).toEqual({
      "1": ["grid", "flags"],
      "2": ["course", "travel"],
      "3": ["notes"],
    });
    await advance();
    expect(save).toHaveBeenCalledWith(null);
  });

  it("keeps the separators inside the width limits", async () => {
    render(<StudentBoard cards={ALL} defaultLayout={defaults} savedLayout={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange cards" }));
    const [first, second] = screen.getAllByRole("separator");
    expect(first).toHaveAttribute("aria-valuenow", "40");

    for (let i = 0; i < 30; i++) fireEvent.keyDown(first!, { key: "ArrowRight" });
    // Column 2 cannot go under 20%, so column 1 stops at 50%.
    expect(first).toHaveAttribute("aria-valuenow", "50");
    expect(first).toHaveAttribute("aria-valuemax", "50");

    for (let i = 0; i < 60; i++) fireEvent.keyDown(first!, { key: "ArrowLeft" });
    expect(first).toHaveAttribute("aria-valuenow", "20");
    expect(second).toHaveAttribute("aria-valuenow", "50");

    await advance();
    const widths = save.mock.calls.at(-1)![0].widths as number[];
    expect(widths[0]).toBeCloseTo(0.2, 3);
    expect(widths[2]).toBeCloseTo(0.3, 3);
  });

  it("shows an error when the layout does not save", async () => {
    save.mockResolvedValue({ ok: false, error: "That layout could not be saved." });
    render(<StudentBoard cards={ALL} defaultLayout={defaults} savedLayout={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Flags up" }));
    await advance();
    expect(within(screen.getByRole("alert")).getByText(/could not be saved/)).toBeInTheDocument();
  });

  it("Done ends arranging and saves straight away", async () => {
    render(<StudentBoard cards={ALL} defaultLayout={defaults} savedLayout={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Grid down" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /move/i })).toBeNull();
    expect(screen.getByText("Grid content").closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Arrange cards" }));
  });
});
