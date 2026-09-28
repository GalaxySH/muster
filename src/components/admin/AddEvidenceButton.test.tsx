// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The modal calls the evidence server actions on submit; stub them to watch which run.
vi.mock("@/lib/evidence/actions", () => ({
  addExtracurricularFile: vi.fn(),
  addTravelRequest: vi.fn(),
  saveExtracurricularNotes: vi.fn(),
  uploadCourseSchedule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { addExtracurricularFile, saveExtracurricularNotes } from "@/lib/evidence/actions";
import { AddEvidenceButton, type EvidenceKind } from "./AddEvidenceButton";
import { localDay } from "@/lib/domain/calendar-day";

/** Open the modal for one evidence kind and hand back its file input. */
function openModal(kind: EvidenceKind, currentNotes = ""): HTMLInputElement {
  render(<AddEvidenceButton kind={kind} studentEmail="stu@wisc.edu" currentNotes={currentNotes} />);
  fireEvent.click(screen.getByRole("button", { name: /add|edit/i }));
  return screen.getByLabelText(/proof/i) as HTMLInputElement;
}

const png = () => new File([new Uint8Array([1, 2, 3])], "proof.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(addExtracurricularFile).mockResolvedValue({ ok: true });
  vi.mocked(saveExtracurricularNotes).mockResolvedValue({ ok: true });
});

describe("AddEvidenceButton", () => {
  it("lets a travel entry go in without proof", () => {
    const file = openModal("travel");
    expect(file.required).toBe(false);
    expect(screen.getByText(/proof \(optional\)/i)).toBeInTheDocument();
  });

  it("opens the travel range on today", () => {
    openModal("travel");
    expect((screen.getByLabelText(/start/i) as HTMLInputElement).value).toBe(localDay(new Date()));
  });

  it("lets extracurricular details be edited without proof", async () => {
    const file = openModal("extracurricular", "Band");
    expect(file.required).toBe(false);
    expect(screen.getByText(/proof \(optional\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: "Band, Tue 6-8pm" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveExtracurricularNotes).toHaveBeenCalledWith("Band, Tue 6-8pm", "stu@wisc.edu"),
    );
    expect(addExtracurricularFile).not.toHaveBeenCalled();
  });

  it("uploads the proof and saves changed details when a file is picked", async () => {
    const file = openModal("extracurricular", "Band");
    fireEvent.change(file, { target: { files: [png()] } });
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: "Choir" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and save" }));

    await waitFor(() =>
      expect(saveExtracurricularNotes).toHaveBeenCalledWith("Choir", "stu@wisc.edu"),
    );
    expect(addExtracurricularFile).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when neither the details nor the proof changed", async () => {
    openModal("extracurricular", "Band");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(saveExtracurricularNotes).not.toHaveBeenCalled();
    expect(addExtracurricularFile).not.toHaveBeenCalled();
  });

  it("still requires proof for a course schedule", () => {
    const file = openModal("course");
    expect(file.required).toBe(true);
  });
});
