// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/lib/admin/actions", () => ({ setTravelResolved: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { UpcomingTravelEntry } from "@/lib/admin/data";
import { UpcomingTravelRow } from "./UpcomingTravelRow";

const LONG_NOTE =
  "Flying home for my sister's wedding, leaving right after my last class on Thursday and back late Sunday night.";

function entry(over: Partial<UpcomingTravelEntry> = {}): UpcomingTravelEntry {
  return {
    id: "t1",
    studentEmail: "ann@wisc.edu",
    studentName: "Ann Lee",
    positionName: "Barista",
    startDate: "2026-01-08",
    endDate: "2026-01-11",
    note: LONG_NOTE,
    excused: true,
    proofFileId: "drive-file-1",
    resolved: false,
    ...over,
  };
}

function renderRow(e: UpcomingTravelEntry) {
  return render(
    <table>
      <tbody>
        <UpcomingTravelRow entry={e} />
      </tbody>
    </table>,
  );
}

describe("UpcomingTravelRow", () => {
  it("clamps the note to two lines and keeps the full text in the title", () => {
    renderRow(entry());
    const note = screen.getByText(LONG_NOTE);
    expect(note).toHaveAttribute("title", LONG_NOTE);
    // The class carries the two-line clamp (admin-lists.css).
    expect(note).toHaveClass("ad-ls-note");
  });

  it("shows nothing extra when there is no note", () => {
    const { container } = renderRow(entry({ note: null }));
    expect(container.querySelector("[title]:not(button)")).toBeNull();
    expect(screen.queryByText(/description/i)).toBeNull();
  });

  it("shows the proof as a lazy preview thumbnail through the evidence proxy", () => {
    renderRow(entry());
    const img = screen.getByRole("img", { name: "Travel proof for Ann Lee" });
    expect(img).toHaveAttribute("src", "/api/evidence/drive-file-1?size=thumb");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("puts the proof on the right, after the name and note", () => {
    renderRow(entry());
    const name = screen.getByRole("link", { name: "Ann Lee" });
    const thumb = screen.getByRole("button", { name: "Travel proof for Ann Lee" });
    const dates = screen.getByText("Jan 8 to Jan 11");
    expect(name.compareDocumentPosition(thumb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(thumb.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A flex wrapper hugs the button, with no baseline gap below it.
    expect(thumb.parentElement).toHaveClass("ad-ls-proof");
    expect(thumb.closest('td[data-label="Proof"]')).not.toBeNull();
    // The dates sit in their own column, so the thumbnails line up from row to row.
    expect(dates.closest('td[data-label="Dates"]')).not.toBeNull();
  });

  it("loads the original only once the lightbox opens", () => {
    renderRow(entry());
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Travel proof for Ann Lee" }));
    const dialog = screen.getByRole("dialog", { name: "Travel proof for Ann Lee" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/evidence/drive-file-1");
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("shows no thumbnail for an entry recorded without proof", () => {
    const { container } = renderRow(entry({ proofFileId: null }));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /travel proof/i })).toBeNull();
  });

  it("keeps the late cues", () => {
    const { container } = renderRow(entry({ excused: false }));
    expect(screen.getByText("late")).toBeInTheDocument();
    expect(container.querySelector("tr")).toHaveClass("ad-tr--danger");
  });

  it("carries both cues on a trip that is late and resolved", () => {
    const { container } = renderRow(entry({ excused: false, resolved: true }));
    const row = container.querySelector("tr");
    expect(row).toHaveClass("ad-tr--danger");
    expect(row).toHaveClass("ad-tr--success");
    expect(screen.getByText("late")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("marks a resolved trip that is not late as resolved only", () => {
    const { container } = renderRow(entry({ resolved: true }));
    const row = container.querySelector("tr");
    expect(row).toHaveClass("ad-tr--success");
    expect(row).not.toHaveClass("ad-tr--danger");
  });

  it("says no proof on a late entry without one", () => {
    renderRow(entry({ excused: false, proofFileId: null }));
    expect(screen.getByText("no proof")).toBeInTheDocument();
  });

  it("gives the position its own cell, outside the name link", () => {
    const { container } = renderRow(entry());
    const position = container.querySelector('td[data-label="Position"]') as HTMLElement;
    expect(position.textContent).toBe("Barista");
    expect(screen.getByRole("link", { name: "Ann Lee" }).contains(position)).toBe(false);
  });

  it("lets a long name break inside the row instead of widening it", () => {
    renderRow(entry({ studentName: "Featherstonehaugh-Worthington" }));
    const column = screen.getByRole("link", { name: "Featherstonehaugh-Worthington" })
      .parentElement as HTMLElement;
    // The class lets the cell break a word anywhere (admin-lists.css).
    expect(column.tagName).toBe("TD");
    expect(column).toHaveClass("ad-ls-break");
  });

  it("shows no separator without a position", () => {
    const { container } = renderRow(entry({ positionName: null }));
    expect(container.querySelector('td[data-label="Position"]')?.textContent).toBe("");
    expect(container.textContent).not.toContain("·");
  });

  it("shows the date range", () => {
    renderRow(entry());
    expect(screen.getByText("Jan 8 to Jan 11")).toBeInTheDocument();
  });
});
