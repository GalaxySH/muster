// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The modal calls the evidence server actions on submit; nothing here submits.
vi.mock("@/lib/evidence/actions", () => ({
  addExtracurricularFile: vi.fn(),
  addTravelRequest: vi.fn(),
  saveExtracurricularNotes: vi.fn(),
  uploadCourseSchedule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AddEvidenceButton, type EvidenceKind } from "./AddEvidenceButton";
import { localDay } from "@/lib/domain/calendar-day";

/** Open the modal for one evidence kind and hand back its file input. */
function openModal(kind: EvidenceKind): HTMLInputElement {
  render(<AddEvidenceButton kind={kind} studentEmail="stu@wisc.edu" />);
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  return screen.getByLabelText(/proof/i) as HTMLInputElement;
}

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

  it("still requires proof for an extracurricular", () => {
    const file = openModal("extracurricular");
    expect(file.required).toBe(true);
  });

  it("still requires proof for a course schedule", () => {
    const file = openModal("course");
    expect(file.required).toBe(true);
  });
});
