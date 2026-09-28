// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const save = vi.fn();
vi.mock("@/lib/availability/actions", () => ({
  saveStudentNotesFor: (...args: unknown[]) => save(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { EditStudentNotesButton } from "./EditStudentNotesButton";

function open(notes = "Mornings only") {
  render(<EditStudentNotesButton studentEmail="stu@wisc.edu" notes={notes} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  return screen.getByLabelText("Student notes") as HTMLTextAreaElement;
}

beforeEach(() => save.mockReset());

describe("EditStudentNotesButton", () => {
  it("opens on the current note and saves the edit", async () => {
    save.mockResolvedValue({ ok: true });
    const box = open();
    expect(box.value).toBe("Mornings only");
    fireEvent.change(box, { target: { value: "Evenings only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("stu@wisc.edu", "Evenings only"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes on Cancel without saving", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("stays open with the error when the save is refused", async () => {
    save.mockResolvedValue({ ok: false, error: "You are not signed in." });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("You are not signed in.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
