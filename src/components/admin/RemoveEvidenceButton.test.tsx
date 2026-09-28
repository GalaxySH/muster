// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/evidence/actions", () => ({
  removeCourseSchedule: vi.fn(),
  removeExtracurricularFile: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { removeCourseSchedule, removeExtracurricularFile } from "@/lib/evidence/actions";
import { RemoveEvidenceButton } from "./RemoveEvidenceButton";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(removeCourseSchedule).mockResolvedValue({ ok: true });
  vi.mocked(removeExtracurricularFile).mockResolvedValue({ ok: true });
});

/** Open the confirm box, then press its Remove. */
function confirmRemove() {
  fireEvent.click(screen.getByRole("button", { name: /remove/i }));
  const dialog = screen.getByRole("dialog");
  const buttons = Array.from(dialog.querySelectorAll("button"));
  fireEvent.click(buttons.find((b) => b.textContent === "Remove")!);
}

describe("RemoveEvidenceButton", () => {
  it("asks before removing anything", () => {
    render(<RemoveEvidenceButton kind="course" studentEmail="stu@wisc.edu" />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(removeCourseSchedule).not.toHaveBeenCalled();
  });

  it("removes the course schedule for the named student", async () => {
    render(<RemoveEvidenceButton kind="course" studentEmail="stu@wisc.edu" />);
    confirmRemove();

    await waitFor(() => expect(removeCourseSchedule).toHaveBeenCalledWith("stu@wisc.edu"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("removes one extracurricular proof by its row", async () => {
    render(
      <RemoveEvidenceButton kind="extracurricular" rowId="row-1" studentEmail="stu@wisc.edu" />,
    );
    confirmRemove();

    await waitFor(() =>
      expect(removeExtracurricularFile).toHaveBeenCalledWith("row-1", "stu@wisc.edu"),
    );
    expect(removeCourseSchedule).not.toHaveBeenCalled();
  });

  it("keeps the box open with the error when removal fails", async () => {
    vi.mocked(removeCourseSchedule).mockResolvedValue({
      ok: false,
      error: "No course schedule is on file.",
    });
    render(<RemoveEvidenceButton kind="course" studentEmail="stu@wisc.edu" />);
    confirmRemove();

    expect(await screen.findByText("No course schedule is on file.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
