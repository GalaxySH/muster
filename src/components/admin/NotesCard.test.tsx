// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const saveStudent = vi.fn();
const saveScheduling = vi.fn();
vi.mock("@/lib/availability/actions", () => ({
  saveStudentNotesFor: (...args: unknown[]) => saveStudent(...args),
}));
vi.mock("@/lib/admin/actions", () => ({
  saveSchedulerNotes: (...args: unknown[]) => saveScheduling(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { NotesCard, type NotesKind } from "./NotesCard";

function renderCard(kind: NotesKind, notes = "Mornings only") {
  render(<NotesCard kind={kind} studentEmail="stu@wisc.edu" notes={notes} />);
}

beforeEach(() => {
  saveStudent.mockReset();
  saveScheduling.mockReset();
});

describe("NotesCard", () => {
  it("shows the whole note with its line breaks, not a text box", () => {
    const long = "First line\n" + "word ".repeat(200).trim();
    renderCard("scheduling", long);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByTitle("Double-click to edit").textContent).toBe(long);
  });

  it("says so when there is no note", () => {
    renderCard("student", "");
    expect(screen.getByText("No notes.")).toBeInTheDocument();
  });

  it.each([
    ["student", "Student notes", saveStudent],
    ["scheduling", "Scheduling notes", saveScheduling],
  ] as const)("edits %s notes from the Edit link", async (kind, title, save) => {
    save.mockResolvedValue({ ok: true });
    renderCard(kind);
    expect(screen.getByText(title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${title.toLowerCase()}` }));
    const box = screen.getByLabelText(title) as HTMLTextAreaElement;
    expect(box.value).toBe("Mornings only");
    fireEvent.change(box, { target: { value: "Evenings only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("stu@wisc.edu", "Evenings only"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the same editor on a double-click of the text", () => {
    renderCard("scheduling");
    fireEvent.doubleClick(screen.getByText("Mornings only"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((screen.getByLabelText("Scheduling notes") as HTMLTextAreaElement).value).toBe(
      "Mornings only",
    );
  });

  it("opens on a double-click of the empty state too", () => {
    renderCard("student", "");
    fireEvent.doubleClick(screen.getByText("No notes."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Cancel without saving", () => {
    renderCard("student");
    fireEvent.click(screen.getByRole("button", { name: "Edit student notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(saveStudent).not.toHaveBeenCalled();
  });

  it("stays open with the error when the save is refused", async () => {
    saveScheduling.mockResolvedValue({ ok: false, error: "You are not signed in." });
    renderCard("scheduling");
    fireEvent.click(screen.getByRole("button", { name: "Edit scheduling notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("You are not signed in.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
