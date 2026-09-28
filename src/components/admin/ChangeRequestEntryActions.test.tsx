// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Both modals call the change-request admin actions; stub them to watch which run.
vi.mock("@/lib/changes/admin-actions", () => ({
  updateChangeRequest: vi.fn(),
  deleteChangeRequest: vi.fn(),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { deleteChangeRequest, updateChangeRequest } from "@/lib/changes/admin-actions";
import { ChangeRequestEntryActions } from "./ChangeRequestEntryActions";

function renderActions(fileCount = 0) {
  render(
    <ChangeRequestEntryActions
      id="req-1"
      day="multiple"
      shiftText="4p to 8p"
      comment="Lab moved."
      permanent={false}
      fileCount={fileCount}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateChangeRequest).mockResolvedValue({ ok: true });
  vi.mocked(deleteChangeRequest).mockResolvedValue({ ok: true });
});

describe("ChangeRequestEntryActions", () => {
  it("opens the editor prefilled and saves the changed request", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect((screen.getByLabelText(/day/i) as HTMLSelectElement).value).toBe("multiple");
    expect((screen.getByLabelText(/permanent/i) as HTMLInputElement).checked).toBe(false);

    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: "tue" } });
    fireEvent.change(screen.getByLabelText(/shift time/i), { target: { value: "5p to 9p" } });
    fireEvent.click(screen.getByLabelText(/permanent/i));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateChangeRequest).toHaveBeenCalledWith("req-1", {
        day: "tue",
        shiftText: "5p to 9p",
        comment: "Lab moved.",
        permanent: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the editor open with the error when the save is refused", async () => {
    vi.mocked(updateChangeRequest).mockResolvedValue({
      ok: false,
      error: "Describe the change you need.",
    });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Describe the change you need.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("mentions the proof files before deleting", async () => {
    renderActions(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/proof files go too/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => expect(deleteChangeRequest).toHaveBeenCalledWith("req-1"));
    expect(refresh).toHaveBeenCalled();
  });

  it("says nothing about proof when there is none", () => {
    renderActions(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText(/proof/i)).not.toBeInTheDocument();
  });
});
